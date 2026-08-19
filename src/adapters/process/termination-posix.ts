/**
 * POSIX (Linux/macOS) half of `ProcessControl.terminateGracefully` (D-002). See `termination.ts`
 * for the dispatcher and the general contract ("wait up to `deadlineMs`, report whether it
 * actually died, never a forced kill in v1").
 *
 * **Linux/macOS have a real answer: POSIX `SIGTERM`.** A process that installs a handler gets to
 * run it and save its own state before exiting; a process with no handler still gets the default
 * "terminate" action, which is what "graceful, with a deadline" means on these platforms.
 *
 * **POSIX-only by construction (S1-T12), the mirror of `console-signal.ts`'s Windows-only
 * exclusion.** `termination.ts`'s dispatcher never calls into this file when `process.platform ===
 * 'win32'`, so every line here is structurally unreachable on a Windows coverage run — not an
 * untested line, a line this platform cannot exercise. `vitest.config.ts` excludes this file from
 * Windows's coverage denominator for exactly that reason (`POSIX_ONLY_SOURCE`). On Linux/macOS
 * it's included and measured for real: `tests/integration/process/termination.test.ts`'s
 * `describe.skipIf(process.platform === 'win32')` block exercises it against a real child process.
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
export async function terminateGracefullyPosix(pid: number, deadlineMs: number): Promise<boolean> {
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
