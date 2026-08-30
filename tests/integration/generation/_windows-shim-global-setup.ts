/**
 * Global setup for the `integration` vitest project (S2-T8). Runs **exactly once**, in vitest's
 * main process, before any worker is spawned (same mechanism as
 * `tests/contract/_version-global-setup.ts`) — confirmed empirically for this fix: an env var set
 * here from a temporary experiment showed up, with the same value, inside two DIFFERENT worker
 * PIDs (`lean-generator.test.ts`'s and `deep-generator.test.ts`'s), because Node's `child_process`
 * always hands a spawned process a copy of the parent's environment at spawn time, and vitest
 * spawns its workers after global setup has already run.
 *
 * That's what this uses: compile `_fixtures.ts`'s Windows `claude.exe` shim once here, and every
 * worker that needs it (`getWindowsShimBinary()`) picks up the already-built path from
 * `WINDOWS_SHIM_PATH_ENV_VAR` instead of running `csc.exe` again. Before this, each test FILE paid
 * its own compile — vitest isolates a file's module registry from every other file's even when
 * they share a worker process (`isolate: true`, the default), so the old per-process memoization
 * in `_fixtures.ts` never actually got reused across files. Two files pay this cost today
 * (`lean-generator.test.ts`, `deep-generator.test.ts`); a third generation test file would have
 * added a third, unrelated compile — the cost was set to grow with the suite, not stay flat.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { compileWindowsShim, WINDOWS_SHIM_PATH_ENV_VAR } from './_fixtures.js';

export async function setup(): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }
  process.env[WINDOWS_SHIM_PATH_ENV_VAR] = await compileWindowsShim();
}

export async function teardown(): Promise<void> {
  const exePath = process.env[WINDOWS_SHIM_PATH_ENV_VAR];
  if (exePath === undefined) {
    return;
  }
  await rm(path.dirname(exePath), { recursive: true, force: true });
}
