/**
 * The pure slice of the process-termination policy (D-002, D-024). The whole policy — checking
 * `canTerminate` by `cwd` in the config, confirming the handoff is written to disk before
 * terminating — is orchestration that belongs to `application/` (S2-T3), out of this task's scope.
 * What lives here is only the type gate D-024 requires: extracting the data needed to terminate a
 * process is only possible from the shape that guarantees `pid`.
 */
import type { SessionWithPid } from './types.js';

export interface ProcessTerminationData {
  readonly pid: number;
  readonly procStart: string;
}

/**
 * Extracts `pid` and `procStart` for the `ProcessControl.terminateGracefully` call (D-002).
 *
 * **Accepts exclusively `SessionWithPid`.** It doesn't accept `DiscoveredSession` (the union) nor
 * `SessionWithoutPid` — the compiler refuses the call in both cases, with no `!` and no `as`
 * anywhere (D-024).
 *
 * **`SessionWithoutSessionId` (D-023, S1-T10) is refused too, on purpose, even though it also
 * carries a real `pid`.** The tempting "fix" is widening this function's parameter to a union of
 * every PID-bearing shape (`SessionWithPid | SessionWithoutSessionId`) so both can reuse the same
 * gate — don't. `SessionWithoutSessionId` has no `procStart` to return in the first place (see
 * that interface's own docstring: there's no prior `.json` entry to tie-break against), so the
 * return type itself would have to grow an optional field just to accommodate a shape that can
 * never legitimately produce it. More importantly, D-023 states plainly that a session known only
 * from this source is never a termination candidate: without a `sessionId`, `seeya` can't verify
 * a handoff was written *for this session* before terminating — D-002's own ordering requirement
 * — because there is no session identity here for that check to key on, only a PID this app
 * inferred from a filename and a live OS process. Keeping the parameter type exactly
 * `SessionWithPid` makes that refusal structural: nobody has to remember the D-023 rule at the
 * call site, because the shape that would violate it doesn't type-check here at all.
 *
 * Whoever holds a `DiscoveredSession` has to narrow first:
 *
 * ```ts
 * if (session.hasPid) {
 *   processTerminationData(session); // compiles: `session` was narrowed to SessionWithPid
 * }
 * ```
 *
 * See tests/unit/core/termination.test.ts for the proof that the PID-less shape **does
 * not** compile (`@ts-expect-error`) — it's the test docs/PLANO-DE-ENTREGA.md S1-T1 literally
 * requires.
 */
export function processTerminationData(session: SessionWithPid): ProcessTerminationData {
  return { pid: session.pid, procStart: session.procStart };
}
