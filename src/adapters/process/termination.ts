/**
 * `ProcessControl.terminateGracefully` (D-002): ask a process to shut down on its own, wait up to
 * `deadlineMs`, and report whether it actually died — never a forced kill in v1.
 *
 * **Linux/macOS have a real answer: POSIX `SIGTERM`.** A process that installs a handler gets to
 * run it and save its own state before exiting; a process with no handler still gets the default
 * "terminate" action, which is what "graceful, with a deadline" means on these platforms.
 *
 * **Windows does not, and this was measured, not assumed** (docs/PLANO-DE-ENTREGA.md S1-T2,
 * pitfall 1; see docs/QUESTOES.md Q-007 for the full evidence). Summary of what was tried against
 * a real detached console process on this machine:
 *
 * - `process.kill(pid, 'SIGTERM')` on a bare external PID does not deliver anything a handler can
 *   observe — it calls `TerminateProcess` directly. Confirmed: a child with a `SIGTERM` handler
 *   that writes a marker file never wrote it, and the process was gone immediately.
 * - `process.kill(pid, 'SIGBREAK')` on a bare external PID throws `ENOSYS` — libuv's `uv_kill`
 *   doesn't support it for an arbitrary PID (only `child.kill()` on a handle *we* spawned would
 *   even attempt it, which doesn't apply here: the sessions this port terminates were never
 *   spawned by `seeya`, they're discovered already running).
 * - `taskkill /PID <pid>` (no `/F`) — Windows' own tool for exactly this — refuses outright for a
 *   console process with no top-level window of its own: *"A finalização deste processo só pode
 *   ser forçada (com a opção /F)."* Reproduced twice, both with and without the target sharing a
 *   console with its parent.
 * - `Stop-Process -Id <pid>` (no `-Force`) behaves the same as `TerminateProcess` under the hood —
 *   no handler ran, no delay.
 * - `GenerateConsoleCtrlEvent` (the Win32 primitive an interactive Ctrl+Break uses) can only be
 *   aimed at a *process group*, not at one arbitrary PID — group 0 broadcasts to every process on
 *   the target's console (the user's whole shell, unacceptable collateral damage), and a specific
 *   group id only exists for a process actually created with `CREATE_NEW_PROCESS_GROUP`, which is
 *   up to whoever launched Claude Code (typically the user's own shell), not `seeya`.
 *
 * **Conclusion, and why this isn't a silent forced kill wearing a "graceful" label:** D-002 bans a
 * forced kill in v1. With no graceful mechanism available and forced kill forbidden, there is
 * nothing left this function is allowed to do to a Windows session — so it does nothing to it.
 * It reports whether the process happens to already be dead, and otherwise returns `false`. That
 * `false` is honest: it means "not terminated", not "termination in progress" or "will die soon".
 */
import { spawn } from 'node:child_process';
import { errorCode, interpretExistenceCheckError } from './liveness.js';
import { processExists } from './existence.js';

const POLL_INTERVAL_MS = 100;

/**
 * Blocks, in a single child process, until `pid` disappears or `maxIterations` polls elapse —
 * entirely inside the shell's own `sleep`, never `setTimeout` (D-019 bans that identifier outside
 * `adapters/clock/`, and this wait has nothing to do with "what time is it": it's a bounded
 * courtesy pause while a signal we already sent takes effect, not a scheduling decision). One
 * subprocess handles the whole wait instead of one per poll tick, which keeps this cheap on
 * Windows-hostile-but-N/A-here platforms and avoids relying on any Node timer API at all.
 */
function waitForExit(pid: number, maxIterations: number): Promise<void> {
  const script = `i=0; while kill -0 "$1" 2>/dev/null; do i=$((i+1)); [ "$i" -ge "$2" ] && exit 0; sleep 0.1; done; exit 0`;
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', script, 'sh', String(pid), String(maxIterations)], {
      stdio: 'ignore',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', () => resolve());
  });
}

/**
 * Sends real `SIGTERM` and waits for it to take effect, bounded by `deadlineMs`. Returns whether
 * the process is gone afterward — the wait subprocess is just a courtesy pause; the true/false
 * answer always comes from re-checking reality (`processExists`), never from trusting the wait
 * script's own exit path.
 */
async function terminateGracefullyPosix(pid: number, deadlineMs: number): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ESRCH') {
      return true; // already gone, nothing to terminate
    }
    if (code === 'EPERM') {
      return false; // exists, but we have no permission to signal it — can't terminate
    }
    interpretExistenceCheckError(error); // throws for anything unrecognized
  }
  const maxIterations = Math.max(1, Math.ceil(deadlineMs / POLL_INTERVAL_MS));
  await waitForExit(pid, maxIterations);
  return !(await processExists(pid));
}

/**
 * See the module comment: no dependency-free graceful mechanism exists on Windows for a PID
 * `seeya` didn't spawn itself, and D-002 forbids a forced kill in v1. This never signals the
 * process; it only reports whether it's already dead.
 */
async function terminateGracefullyWindows(pid: number): Promise<boolean> {
  return !(await processExists(pid));
}

export function terminateGracefully(
  pid: number,
  deadlineMs: number,
  platform: string = process.platform,
): Promise<boolean> {
  if (platform === 'win32') {
    return terminateGracefullyWindows(pid);
  }
  return terminateGracefullyPosix(pid, deadlineMs);
}
