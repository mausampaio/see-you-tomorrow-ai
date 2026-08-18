/**
 * The pure slice of the process-termination policy (D-002, D-024). The whole policy — checking
 * `podeEncerrar` by `cwd` in the config, confirming the handoff is written to disk before
 * terminating — is orchestration that belongs to `aplicacao/` (S2-T3), out of this task's scope.
 * What lives here is only the type gate D-024 requires: extracting the data needed to terminate a
 * process is only possible from the shape that guarantees `pid`.
 */
import type { SessionWithPid } from './tipos.js';

export interface ProcessTerminationData {
  readonly pid: number;
  readonly procStart: string;
}

/**
 * Extracts `pid` and `procStart` for the `ProcessControl.terminateGracefully` call (D-002).
 *
 * **Accepts exclusively `SessionWithPid`.** It doesn't accept `DiscoveredSession` (the union) nor
 * `SessionWithoutPid` — the compiler refuses the call in both cases, with no `!` and no `as`
 * anywhere (D-024). Whoever holds a `DiscoveredSession` has to narrow first:
 *
 * ```ts
 * if (session.hasPid) {
 *   processTerminationData(session); // compiles: `session` was narrowed to SessionWithPid
 * }
 * ```
 *
 * See tests/unidade/nucleo/encerramento.teste.ts for the proof that the PID-less shape **does
 * not** compile (`@ts-expect-error`) — it's the test docs/PLANO-DE-ENTREGA.md S1-T1 literally
 * requires.
 */
export function processTerminationData(session: SessionWithPid): ProcessTerminationData {
  return { pid: session.pid, procStart: session.procStart };
}
