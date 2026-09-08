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
 * `console-signal.ts` (S1-T2b) and `termination-windows.ts` (S1-T12, split out of the old
 * `termination.ts`) are Windows-only by construction: every line in them either builds a
 * PowerShell/P-Invoke script, spawns `powershell.exe` to run one, or only ever executes when
 * `termination.ts`'s dispatcher picks the Windows branch — and that purpose (attaching to
 * another process's console and broadcasting `CTRL_BREAK_EVENT`,
 * docs/spikes/G-ctrl-break-no-windows.md) has no Linux/macOS equivalent to fall back to.
 * `npm run verificar` (this machine) exercises both for real
 * (`tests/integration/process/termination.test.ts`'s Windows describe block). Counting them
 * against `npm run verificar:linux`'s coverage denominator would penalize the project for code
 * that structurally cannot run in that container — not a gap in testing, a gap in what Linux can
 * even attempt. Measured (S1-T2b, `console-signal.ts` alone): leaving it in dropped the Linux
 * run's aggregate to ~74%, below the 80% threshold, entirely from this one file's Windows-only
 * lines.
 */
const WINDOWS_ONLY_SOURCE = [
  'src/adapters/process/console-signal.ts',
  'src/adapters/process/termination-windows.ts',
];

/**
 * The mirror image of `WINDOWS_ONLY_SOURCE` (S1-T12): `termination-posix.ts` only ever executes
 * when `termination.ts`'s dispatcher picks the non-Windows branch (real `SIGTERM`, a POSIX-only
 * concept), so it's structurally unreachable on a Windows coverage run — measured at 0% on this
 * Windows machine before this exclusion existed, which is what made `adapters/process` fail its
 * own per-directory floor here despite `tests/integration/process/termination.test.ts`'s POSIX
 * describe block covering it for real on Linux/macOS. Same shape of problem as
 * `WINDOWS_ONLY_SOURCE`, opposite direction, same fix: exclude it from the denominator of the
 * platform that structurally cannot run it, never from the platform that can.
 */
const POSIX_ONLY_SOURCE = ['src/adapters/process/termination-posix.ts'];

/**
 * These five integration files launch a REAL `powershell.exe` (`adapters/process/proc-start.ts`'s
 * `captureWindows`, `adapters/process/console-signal.ts`'s `sendCtrlBreak`) rather than touching an
 * isolated tmpdir like the rest of `integration/` — they contend for the SAME scarce resource: the
 * OS's capacity to launch a process, measured as 500-880ms per `powershell.exe` launch even WARM
 * (`proc-start.ts`'s own docstring). Under `integration`'s default parallelism every file gets its
 * own concurrent worker; when several of THESE FIVE land in the same batch, their real launches
 * queue behind each other and blow straight through the fixed 5s/8s deadlines the tests carry —
 * not a hang, a resource fight the deadline was never sized to survive.
 *
 * Measured (S4-T10, 2026-09-08, this machine, `git rev-parse HEAD` = the commit right before this
 * task): `npm run verificar` red with 2-3 of these five timing out, a DIFFERENT subset each run,
 * while every other integration file (isolated tmpdir, never launches a real process) stayed green
 * across the same runs. `composition.test.ts` belongs in this group for the identical reason even
 * though an earlier pass at isolating this only named the other four — it calls
 * `captureObservedProcStart` too (see its own `buildCliContext` test) and failed the same way in
 * the baseline run that diagnosed this. See docs/TESTES.md for the full measurement and the
 * before/after total.
 *
 * The OLD comment on the `integration` project below claimed "the rest of integration/ ... doesn't
 * contend for any resource, so it keeps Vitest's default parallelism" — true for 37 of 42 files,
 * false for these five, and that false generality is what sent this investigation looking at the
 * wrong layer first. Corrected in place rather than left to mislead the next reader (AGENTS.md: a
 * comment that asserts beyond its evidence is the same defect D-025 names for data).
 */
const PROCESS_HEAVY_INTEGRATION_FILES = [
  'tests/integration/cli/composition.test.ts',
  'tests/integration/cli/daemon-command.test.ts',
  'tests/integration/process/liveness.test.ts',
  'tests/integration/process/termination.test.ts',
  'tests/integration/scheduler/lock.test.ts',
];

/**
 * Per-directory coverage (docs/TESTES.md): `core/` 95%, every other production directory 80%.
 * One glob key PER directory, not a catch-all `'src/**'` for "everything but core" (S1-T12): a
 * catch-all glob matches every instrumented file, so it computes the exact same number as the
 * unscoped aggregate — measured the day this was found, `'src/**'` read 91.7% (a passing grade)
 * while `adapters/process` sat at 78.19% on its own, below its own 80% floor, carried by
 * everything else's slack. Only a glob scoped to one directory can catch that directory's own
 * decay.
 *
 * This list has to stay exhaustive over every directory `src/` actually has, or a new directory
 * gets silently zero floor — the same shape of gap S1-T0e closed for vitest's test projects.
 * `tests/integration/guards/_coverage-directories.ts` declares that same list independently
 * (never derived from this object) and `coverage-directories.test.ts` fails if the two disagree,
 * in either direction, or if either disagrees with the real `src/` tree.
 *
 * `perFile` (a vitest coverage option) is deliberately NOT used here: it would require every
 * INDIVIDUAL file to clear the threshold, which is a stricter, different promise than the one
 * docs/TESTES.md makes ("per directory"). A directory can be healthy in aggregate while one small
 * file inside it has a single hard-to-reach branch — exactly the shape `spawn-stdout.ts` and
 * `proc-start.ts` are in today — and `perFile` would fail the build on that alone, for a reason
 * disconnected from the actual finding this task fixed (a directory's decay hiding behind
 * others'). Per-directory grouping is the right grain for what was promised; per-file is a
 * different, stricter policy nobody asked for.
 */
const PRODUCTION_DIRECTORY_THRESHOLDS = {
  'src/core/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
  'src/application/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/scheduler/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  // cli/index.ts alone stays out of coverage.exclude below (thin commander wiring, exercised for
  // real only by the compiled e2e journey, docs/TESTES.md nº1) — but S1-T6 gave cli/ several
  // other files with real branching (composition.ts, session-view.ts, format-sessions.ts,
  // eligibility-view.ts, format-status.ts, the two *-command.ts orchestrators), so the directory
  // now carries the same 80% floor every other adapter does instead of staying uncovered by
  // default. See tests/integration/guards/_coverage-directories.ts.
  'src/cli/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/clock/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/discovery/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/generation/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/git/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/notification/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/process/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/resumption/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/storage/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
  'src/adapters/transcript/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
};

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Q-025: at the ROOT, so every project gets it — not just `integration`, where it started.
    // `powershell.exe` is reachable from `src/adapters/process/` in general, so a future test in
    // any project can spawn it; wired per-project, each such test would hit a cold binary with no
    // warm-up and reopen this same decision from scratch. Measured: a root `globalSetup` runs for
    // projects that declare none, and coexists with a project's own (both fire). See the file's
    // own docstring for the numbers.
    globalSetup: ['tests/_powershell-warmup-global-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude:
        process.platform === 'win32'
          ? ['src/cli/index.ts', ...POSIX_ONLY_SOURCE]
          : ['src/cli/index.ts', ...WINDOWS_ONLY_SOURCE],
      thresholds: PRODUCTION_DIRECTORY_THRESHOLDS,
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
          // src/ tree. `PROCESS_HEAVY_INTEGRATION_FILES` (S4-T10) has its own project too, for a
          // different reason: those five launch a real `powershell.exe` and contend with each
          // other for the OS's process-launch capacity under parallelism, at fixed 5s/8s test
          // deadlines the measured 500-880ms warm cost doesn't leave enough room for once more
          // than one is in flight at once. Every OTHER file left in `integration` (discovery/,
          // storage/, git/, notification/, the rest of process/ and cli/, starting at Sprint 1)
          // uses a per-test isolated tmpdir and never launches a real process, so it genuinely
          // doesn't contend for anything and keeps Vitest's default parallelism.
          exclude: [
            ...configDefaults.exclude,
            'tests/integration/guards/**',
            ...PROCESS_HEAVY_INTEGRATION_FILES,
          ],
          // S2-T8: pays the `csc.exe` shim compilation exactly ONCE for the whole project run,
          // instead of leaving it to whichever test file's worker hits it first (see that global
          // setup's own comment). Stays here, project-scoped, while its `powershell.exe` sibling
          // moved to the root (Q-025): this one costs seconds rather than milliseconds, and its
          // only consumer is a fixture that is structurally integration-only. No-op on POSIX.
          globalSetup: ['tests/integration/generation/_windows-shim-global-setup.ts'],
        },
      },
      {
        test: {
          // S4-T10: the five files in `PROCESS_HEAVY_INTEGRATION_FILES` (see that const's own
          // docstring for the measurement). `fileParallelism: false` here — and ONLY here — makes
          // these five run one after another, so none of their real `powershell.exe` launches ever
          // overlaps a sibling's. This is not the same move S1-T0 rejected for `guards/`: that
          // serialization would have HIDDEN a real race in shared fixture state (the bug was the
          // race, not the timing); this one REMOVES real contention for a real, measured, scarce
          // resource that the tests' own fixed deadlines were never sized to share. The other 37
          // integration files never touch `powershell.exe`, so they pay none of this cost and keep
          // full default parallelism in the `integration` project above.
          name: 'integration-process',
          include: PROCESS_HEAVY_INTEGRATION_FILES,
          fileParallelism: false,
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
