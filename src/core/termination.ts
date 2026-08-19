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
 * **Between S1-T10 and S1-T11, a second PID-bearing shape (`SessionWithoutSessionId`, D-023) also
 * had to be refused here, on purpose, for a reason narrower typing alone couldn't express: no
 * `sessionId` to verify a handoff against before terminating (D-002's ordering requirement).**
 * D-029 (S1-T11) removed that shape from the union entirely, so there's nothing left to widen this
 * function's parameter to by accident — `SessionWithPid` is once again the only PID-bearing shape
 * that exists. The reasoning stays on record in docs/DECISOES.md D-029/D-023 in case a future
 * PID-bearing shape reopens the question.
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
