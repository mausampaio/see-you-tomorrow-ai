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
