/**
 * Global setup for the `integration` vitest project (S2-T8, second finding). Spawns
 * `powershell.exe` once, in vitest's main process, before any worker starts — the same timing
 * guarantee `generation/_windows-shim-global-setup.ts` uses for `csc.exe`, applied to a second,
 * unrelated cold-start cost this task's real-CI measurement surfaced.
 *
 * Found investigating this task on the actual Windows CI runner (docs/QUESTOES.md Q-025): with
 * the `csc.exe` fix above already in place, `tests/integration/cli/composition.test.ts`'s
 * `buildCliContext` test — which has never carried an explicit timeout, relying on vitest's 5s
 * default — still failed with "Test timed out in 5000ms" on windows-latest. That test's only slow
 * step is `captureObservedProcStart` (`src/adapters/process/proc-start.ts#captureWindows`),
 * which spawns `powershell.exe -NoProfile -Command "(Get-Process ...).StartTime..."` — a real
 * subprocess, not a fake. `tests/integration/process/liveness.test.ts` and
 * `termination.test.ts`'s Windows describe block (via `console-signal.ts`) hit the exact same
 * binary. On a freshly booted CI VM, the FIRST `powershell.exe` launch pays a real cold-start
 * cost (loading `System.Management.Automation.dll` and friends from disk for the first time);
 * every later launch on the same machine is fast because the OS file cache already has those
 * pages — same shape of problem as the `csc.exe` one this file's sibling fixes, and the same
 * remedy: pay the cold cost exactly once, deliberately, before any test's own budget starts
 * ticking, instead of leaving it to whichever test file's worker happens to reach `powershell.exe`
 * first.
 *
 * The command run here is irrelevant — `exit` — because the cost being amortized is starting the
 * `powershell.exe` process itself, not any particular cmdlet.
 */
import { runForStdout } from '../../../src/adapters/process/spawn-stdout.js';

export async function setup(): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }
  await runForStdout('powershell.exe', ['-NoProfile', '-Command', 'exit']);
}
