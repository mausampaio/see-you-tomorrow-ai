/**
 * The parts of PID liveness that don't need a real OS call: interpreting the error `kill(pid, 0)`
 * raises, and combining that with a `procStart` tie-break capture into the final answer. Split
 * out from `index.ts` so this branching is unit-testable directly, with fabricated inputs and no
 * real process (docs/TESTES.md § Unidade: "interpretação de código de erro, comparação de
 * procStart, sem processo real").
 */

/**
 * Result of trying to read the OS's current `procStart` for an already-confirmed-alive `pid`, to
 * compare against the value recorded at discovery time (`pidRepresentsSameProcess`,
 * `core/classification.ts`).
 *
 * Three outcomes, not two, because "couldn't compare" and "compared and it's a different process"
 * must never collapse into the same value (D-025, and the third pitfall named in
 * docs/PLANO-DE-ENTREGA.md S1-T2). `checkProcessExists` already handles "already dead" as its own
 * case before this type ever comes into play — `processGone` here is specifically the narrower
 * race where the PID existed a moment ago but vanished between the existence check and the
 * `procStart` read.
 */
export type ProcStartCapture =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'processGone' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Node/libuv errors are thrown as plain `Error` objects with a `.code` string bolted on
 * (`NodeJS.ErrnoException`) — there's no narrower type `catch` can bind to a caught value than
 * `unknown`. One small type guard here, reused by every file in this adapter that inspects an
 * error code, is the single place that `as`s its way past that instead of each call site doing it
 * inline (AGENTS.md: `as` is a sign the type is wrong, not that the author knows better — the
 * outside world genuinely has no stronger type to offer here, so this narrows it once).
 */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return String(error.code);
}

/**
 * Classifies the error `process.kill(pid, 0)` raises on a PID that isn't reachable.
 *
 * **`ESRCH` means dead. `EPERM` means alive** (docs/PLANO-DE-ENTREGA.md S1-T2, pitfall 2): the
 * kernel only refuses to signal a PID that exists — a dead PID raises "no such process", not
 * "permission denied". Reading `EPERM` as "dead" is the classic bug this check exists to avoid.
 *
 * **Any other code is not silently one or the other.** `process.kill(pid, 0)` on the three
 * supported platforms is only ever documented to raise `ESRCH` or `EPERM` (measured on Windows:
 * see tests/integration/process — a nonexistent PID raises `ESRCH`, PID 4 (`System`, protected)
 * raises `EPERM`). A third code would mean the assumption behind this whole check stopped
 * holding, and guessing `true` or `false` at that point would be exactly the kind of invented
 * middle ground docs/PLANO-DE-ENTREGA.md warns against — so this throws instead of answering.
 */
export function interpretExistenceCheckError(error: unknown): 'alive' {
  if (errorCode(error) === 'EPERM') {
    return 'alive';
  }
  throw error;
}

/**
 * Combines basic OS liveness with the `procStart` tie-break into `ProcessControl.isAlive`'s
 * answer. Pure — no I/O, no process, unit-tested directly with fabricated `ProcStartCapture`
 * values (docs/PLANO-DE-ENTREGA.md S1-T2 aceite items 3 and 4).
 *
 * - No PID at all (`pidExists: false`): dead, tie-break is moot.
 * - PID exists, no `procStart` supplied: alive, nothing to break a tie on.
 * - PID exists, `procStart` supplied, and the current value could be read: the pure comparison in
 *   `core/classification.ts#pidRepresentsSameProcess` decides — a divergent value means the OS
 *   recycled the PID onto an unrelated process, which is correctly "not alive" as far as the
 *   caller's registered session is concerned.
 * - PID exists, `procStart` supplied, but the current value **could not** be read or compared
 *   (`unavailable`): **not `false`** (D-025). The tie-break is inconclusive, not evidence of
 *   death — the least specific truthful answer left is the basic liveness the PID check already
 *   established, i.e. `true`.
 * - PID existed but vanished by the time the `procStart` read ran (`processGone`, a real race,
 *   not "can't tell"): `false` — this is positive evidence, not an absence of it.
 */
export function resolveIsAlive(
  pidExists: boolean,
  procStart: string | undefined,
  capture: ProcStartCapture | undefined,
  sameProcess: (registered: string, observed: string) => boolean,
): boolean {
  if (!pidExists) {
    return false;
  }
  if (procStart === undefined || capture === undefined) {
    return true;
  }
  if (capture.kind === 'processGone') {
    return false;
  }
  if (capture.kind === 'unavailable') {
    return true;
  }
  return sameProcess(procStart, capture.value);
}
