/**
 * Root-level global setup — every vitest project, not just `integration` (S2-T8 found it,
 * Q-025 promoted it). Spawns
 * `powershell.exe` once, in vitest's main process, before any worker starts — the same timing
 * guarantee `integration/generation/_windows-shim-global-setup.ts` uses for `csc.exe`, applied to a
 * second, unrelated cold-start cost this task's real-CI measurement surfaced.
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
 *
 * **Why the root and not the `integration` project (Q-025).** It started wired to `integration`,
 * because that is where the three known callers lived. But `powershell.exe` is reachable from
 * `src/adapters/process/` generally, so any future test in ANY project can spawn it — and would
 * then hit a cold binary with no warm-up and reopen this same decision from scratch. Measured:
 * a `globalSetup` declared at the root runs for a project that declares none, and coexists with a
 * project's own (both fire), so promoting it here removes the wiring step a new test could miss.
 * The cost of covering projects that never touch `powershell.exe` is one warm spawn per run
 * (~450ms measured on a warm Windows dev machine, no-op on POSIX) — cheap next to the >5s
 * timeout the cold path produced on CI. Its `csc.exe` sibling deliberately did NOT follow: that
 * one compiles a shim, costing seconds rather than milliseconds, and its only consumer is a
 * fixture that is structurally integration-only.
 */
import { runForStdout } from '../src/adapters/process/spawn-stdout.js';

export async function setup(): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }
  await runForStdout('powershell.exe', ['-NoProfile', '-Command', 'exit']);
}
