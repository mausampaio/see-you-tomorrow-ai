/**
 * `ProcessControl.terminateGracefully` (D-002): ask a process to shut down on its own, wait up to
 * `deadlineMs`, and report whether it actually died — never a forced kill in v1.
 *
 * Dispatches to a platform-specific implementation: `terminateGracefullyPosix` (real `SIGTERM`,
 * `termination-posix.ts`) or `terminateGracefullyWindows` (`CTRL_BREAK_EVENT` via console attach,
 * `termination-windows.ts`). See those two files for what each mechanism actually does, what was
 * measured to justify it, and what it still can't reach.
 *
 * **Split into three files, not one (S1-T12).** This used to be a single file with both platform
 * branches inline. Each branch only ever executes on its own platform, which made the combined
 * file's coverage number platform-dependent in a way the per-directory floor (docs/TESTES.md)
 * couldn't tell apart from an actually-untested line: on this Windows host, the POSIX branch
 * measured 0% covered — not because it lacks tests (`tests/integration/process/termination.test.ts`
 * exercises it on Linux/macOS via `describe.skipIf`), but because it structurally cannot run here.
 * Splitting the platform-only code into its own file lets `vitest.config.ts` exclude each one from
 * the OTHER platform's coverage denominator — the same legitimate exclusion already applied to
 * `console-signal.ts`, now applied symmetrically in both directions.
 */
import { terminateGracefullyPosix } from './termination-posix.js';
import { terminateGracefullyWindows } from './termination-windows.js';
import { errorCode } from './liveness.js';

export function terminateGracefully(
  pid: number,
  deadlineMs: number,
  platform: string = process.platform,
): Promise<boolean> {
  if (platform === 'win32') {
    return terminateGracefullyWindows(pid, deadlineMs);
  }
  return terminateGracefullyPosix(pid, deadlineMs);
}

/**
 * Unconditional, immediate termination (`SIGKILL`) — **never** used on a discovered Claude Code
 * session (D-002 bans forced kill for those in v1; `terminateGracefully` above is the only verb
 * that ever touches one). This exists solely for `cli/daemon-command.ts#runDaemonStop` (S4-T5) to
 * end `seeya`'s OWN background daemon when there is no graceful path left to try:
 *
 * - **Windows**: the daemon runs detached with no console at all (D-005), so
 *   `terminateGracefullyWindows`'s `CTRL_BREAK_EVENT` can never be delivered — `AttachConsole`
 *   fails with error 6 the instant it's tried (`docs/spikes/G-ctrl-break-no-windows.md`'s own "what
 *   was not proven": a console-less target). A bare cross-process signal doesn't help either:
 *   `process.kill(pid, 'SIGTERM')` from a DIFFERENT process on Windows calls `TerminateProcess`
 *   immediately — the target's own JS handler never runs at all (measured building S4-T3b,
 *   `tests/integration/process/daemon-launch.test.ts`'s own comment on this exact call). There is
 *   no graceful mechanism to exhaust first; this function IS the only one available.
 * - **POSIX**: `runDaemonStop` only reaches this as a last resort, after a real `SIGTERM`
 *   (`terminateGracefully`) was given a generous window and the process still didn't exit.
 *
 * Tolerates the pid already being gone (`ESRCH`) — success, not failure, for a function whose only
 * job is "make sure it's dead". Anything else rethrows: guessing success on an unrecognized OS
 * error would be exactly the invented middle ground `liveness.ts#interpretExistenceCheckError`
 * already refuses to produce for the same class of surprise.
 */
export function terminateAbruptly(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (errorCode(error) === 'ESRCH') {
      return Promise.resolve();
    }
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  return Promise.resolve();
}
