import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Test projects split by track (see docs/TESTES.md). `unit` and `integration` run in
 * `npm test`; `e2e` and `contract` are opt-in via `npm run test:e2e` / `npm run test:contrato`.
 * All of them may be empty in this task (S0-T1) — `passWithNoTests` (a global option, not per
 * project) avoids a failure from a track having no tests yet.
 */
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
      exclude: ['src/cli/index.ts'],
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
