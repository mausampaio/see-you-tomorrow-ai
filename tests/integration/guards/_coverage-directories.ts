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
 * `cli/` is `covered` at 80% since S1-T6, not `excluded` — the directory grew past its single
 * wiring file the moment `sessions`/`status` needed a composition root, view-model assembly and
 * text formatting of their own. Only `index.ts` itself stays out of `coverage.include` in
 * vitest.config.ts (thin `commander` wiring, exercised for real only by the compiled e2e journey,
 * docs/TESTES.md nº1) — every other file under `cli/` is real branching logic and carries the
 * same floor every other adapter directory does.
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
  { path: 'cli', expectation: { kind: 'covered', threshold: 80 } },
];
