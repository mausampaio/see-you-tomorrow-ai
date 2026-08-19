import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Test projects split by track (see docs/TESTES.md). `unit` and `integration` run in
 * `npm test`; `e2e` and `contract` are opt-in via `npm run test:e2e` / `npm run test:contrato`.
 *
 * `passWithNoTests` (S0-T1) is a global option, not per project, and stays on: `integration` and
 * `e2e` are legitimately empty right now (their adapters/commands haven't landed yet), and
 * turning it off would make `npm test` red for no real defect. What it can't do on its own is
 * tell "legitimately empty" apart from "glob stopped matching by accident" — that gap is exactly
 * what bit S1-T0d (a directory rename before updating this file exited 0 with zero tests run).
 * `tests/integration/guards/test-projects.test.ts` is what closes it: it declares, independently
 * of this file, which project is expected to be empty and why, and fails if any project's real
 * file count disagrees (S1-T0e).
 */
/**
 * `console-signal.ts` (S1-T2b) is Windows-only by construction: every line in it either builds a
 * PowerShell/P-Invoke script or spawns `powershell.exe` to run one, and its purpose — attaching
 * to another process's console and broadcasting `CTRL_BREAK_EVENT`
 * (docs/spikes/G-ctrl-break-no-windows.md) — has no Linux/macOS equivalent to fall back to.
 * `npm run verificar` (this machine) exercises it for real, at ~90% coverage
 * (`tests/integration/process/termination.test.ts`'s Windows describe block). Counting it against
 * `npm run verificar:linux`'s coverage denominator would penalize the project for code that
 * structurally cannot run in that container — not a gap in testing, a gap in what Linux can even
 * attempt. Measured: leaving it in dropped the Linux run's aggregate to ~74%, below the 80%
 * threshold, entirely from this one file's Windows-only lines.
 */
const WINDOWS_ONLY_SOURCE = ['src/adapters/process/console-signal.ts'];

export default defineConfig({
  test: {
    passWithNoTests: true,
    /**
     * Per-directory coverage (docs/TESTES.md): core/ 95%, other production directories 80%.
     * Only measured when the suite runs with `--coverage` (the `npm run cobertura` script,
     * called by `npm run verificar`) — `test:e2e` and `test:contrato` don't pass that flag and
     * aren't affected by the threshold.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude:
        process.platform === 'win32'
          ? ['src/cli/index.ts']
          : ['src/cli/index.ts', ...WINDOWS_ONLY_SOURCE],
      thresholds: {
        'src/core/**': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        'src/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          // guards/ has its own project (see below) because it writes fixtures into the real
          // src/ tree; the rest of integration/ (discovery/, storage/, git/, process/,
          // notification/ starting at Sprint 1) uses a per-test isolated tmpdir and doesn't
          // contend for any resource, so it keeps Vitest's default parallelism.
          exclude: [...configDefaults.exclude, 'tests/integration/guards/**'],
        },
      },
      {
        test: {
          name: 'guards',
          include: ['tests/integration/guards/**/*.test.ts'],
          // NO fileParallelism: false here, on purpose (S1-T0). S0-T6 serialized this project
          // because the guards write fixtures into the real src/ tree and were contending for
          // the same mutable resource — but serializing only HID a real race (commit 6899f99,
          // CI red on Linux/macOS, green by timing luck on Windows). The real fix was making the
          // tests insensitive to tree state (fixture isolated per test file, dependency-cruiser
          // scoped to its own fixture — see tests/integration/guards/_support.ts), not
          // preventing concurrency from happening. DO NOT reintroduce `fileParallelism: false`
          // to "fix" a failure here: running in parallel, Vitest is what EXPOSES a new race as
          // early as possible; serialized, it sleeps until someone touches this config again,
          // exactly like it happened the first time.
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'contract',
          include: ['tests/contract/**/*.test.ts'],
          /**
           * Writes the installed Claude Code version straight to stdout before any test runs —
           * this is what guarantees docs/TESTES.md ("always log the version") on the default
           * reporter's happy path, which doesn't print test names when everything passes. See
           * tests/contract/_version-global-setup.ts.
           */
          globalSetup: ['tests/contract/_version-global-setup.ts'],
        },
      },
    ],
  },
});
