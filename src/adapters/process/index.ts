/**
 * Process adapter: PID liveness and graceful termination, implements `ProcessControl`. See
 * docs/ARQUITETURA.md, docs/DECISOES.md D-002/D-016/D-019/D-025 and
 * docs/PLANO-DE-ENTREGA.md S1-T2.
 *
 * The real OS-touching work is split by concern into sibling modules so the branching logic can
 * be unit-tested without a real process (docs/TESTES.md § Unidade):
 * - `liveness.ts` — pure decision (`resolveIsAlive`) and OS-error interpretation, no I/O.
 * - `existence.ts` — the one "does this PID exist" OS call, shared by both port methods.
 * - `proc-start.ts` — per-platform capture of the OS's current `procStart`.
 * - `termination.ts` — `terminateGracefully`, real `SIGTERM` on POSIX, no-op on Windows (see that
 *   file's comment and docs/QUESTOES.md Q-007 for why).
 */
import type { ProcessControl } from '../../core/ports.js';
import { pidRepresentsSameProcess } from '../../core/classification.js';
import { resolveIsAlive } from './liveness.js';
import { processExists } from './existence.js';
import { captureObservedProcStart } from './proc-start.js';
import { terminateGracefully } from './termination.js';

async function isAlive(pid: number, procStart?: string): Promise<boolean> {
  const pidExists = await processExists(pid);
  if (!pidExists || procStart === undefined) {
    return resolveIsAlive(pidExists, procStart, undefined, pidRepresentsSameProcess);
  }
  const capture = await captureObservedProcStart(pid, processExists);
  return resolveIsAlive(pidExists, procStart, capture, pidRepresentsSameProcess);
}

export const processControl: ProcessControl = {
  isAlive,
  terminateGracefully,
};
