/**
 * Independent declaration of docs/TESTES.md's per-directory coverage floor (`core/` 95%, every
 * other production directory 80%) — the S1-T12 counterpart to `_layer-matrix.ts` (S0-T6) and
 * `_test-projects.ts` (S1-T0e), same philosophy applied to a third config file.
 *
 * S1-T12 found that vitest.config.ts's `coverage.thresholds` keyed `'src/**'` for "every other
 * directory" — a glob that matches every file under `src/`, not the complement of `src/core/**`.
 * Measured: it computed the SAME number as the unscoped aggregate (91.7% the day this was
 * found), so a directory sitting well below 80% (`adapters/process`, 78.19%) passed anyway. The
 * fix is one glob PER production directory (vitest.config.ts's `PRODUCTION_DIRECTORY_THRESHOLDS`)
 * — but a literal, hand-written list of glob keys has the exact same blind spot `_test-projects.ts`
 * already named for the vitest project list: a directory added to `src/` after that object was
 * written gets no glob, no threshold, no protection, and nothing says so.
 *
 * `coverage-directories.test.ts` closes that gap the same way `test-projects.test.ts` does for
 * vitest's projects: it compares this list against the REAL `src/` tree, and against
 * vitest.config.ts's REAL `coverage.thresholds` keys, in both directions — never deriving one
 * from the other. A directory that exists in `src/` but not here fails loudly instead of coasting
 * on whatever glob happens to also match it.
 */

export type CoverageExpectation =
  | { readonly kind: 'covered'; readonly threshold: number }
  | {
      readonly kind: 'excluded';
      /** Why this directory carries no coverage floor at all — read before adding logic here. */
      readonly reason: string;
    };

export interface DeclaredCoverageDirectory {
  /** Path relative to `src/`, forward-slashed (e.g. `'adapters/process'`). */
  readonly path: string;
  readonly expectation: CoverageExpectation;
}

/**
 * Every directory directly under `src/` that holds at least one production `.ts` file, as of
 * S1-T12. `core/` keeps the stricter 95% (docs/TESTES.md); every other covered directory is 80%.
 *
 * `cli/` is declared `excluded`, not `covered` at some threshold: its only file, `index.ts`, is
 * the composition root (D-020) and is already dropped from `coverage.include`/`exclude` entirely
 * in vitest.config.ts, so no threshold key targets it. Declaring it here — instead of just
 * omitting it — is what lets the "does the real `src/` tree match this list" check below tell
 * "known and deliberately uncovered" apart from "forgotten"; an omitted `cli/` would fail that
 * check for the wrong reason.
 */
export const DECLARED_COVERAGE_DIRECTORIES: readonly DeclaredCoverageDirectory[] = [
  { path: 'core', expectation: { kind: 'covered', threshold: 95 } },
  { path: 'application', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'scheduler', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'adapters/clock', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'adapters/discovery', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'adapters/generation', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'adapters/git', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'adapters/notification', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'adapters/process', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'adapters/storage', expectation: { kind: 'covered', threshold: 80 } },
  { path: 'adapters/transcript', expectation: { kind: 'covered', threshold: 80 } },
  {
    path: 'cli',
    expectation: {
      kind: 'excluded',
      reason:
        'cli/ is the composition root (D-020); its only file, index.ts, is wiring with no ' +
        "branching logic of its own, and is already dropped from coverage's include set " +
        'entirely (vitest.config.ts, coverage.exclude) rather than measured and forgiven.',
    },
  },
];
