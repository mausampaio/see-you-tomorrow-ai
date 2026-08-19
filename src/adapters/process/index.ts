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
 * - `termination.ts` — `terminateGracefully`: real `SIGTERM` on POSIX, `CTRL_BREAK_EVENT` via a
 *   PowerShell helper on Windows (`console-signal.ts`, docs/spikes/G-ctrl-break-no-windows.md).
 * - `console-signal.ts` — the Windows-only P/Invoke helper `termination.ts` sends the console
 *   event through.
 *
 * **This list briefly included `inspection.ts` — `readCwd`/`readCommandLine` (D-023, S1-T10) —
 * removed in S1-T11 (D-029)** along with the discovery strategy that was its only caller. See
 * `core/ports.ts`'s `ProcessControl` docstring for why.
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
