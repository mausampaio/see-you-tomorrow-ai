/**
 * Independent declaration of the vitest projects (see docs/TESTES.md) and what "correctly
 * resolved" means for each — the S1-T0e counterpart to `_layer-matrix.ts` (S0-T6), same
 * philosophy applied to a different config file.
 *
 * `test-projects.test.ts` compares this list against vitest.config.ts's REAL project set instead
 * of reading the projects straight out of that file. This is the whole point of the guard, not a
 * style choice: `passWithNoTests: true` is global in vitest.config.ts, so a project whose
 * `include` glob stops matching anything still exits 0, silently. That's exactly what happened
 * during S1-T0d — renaming `tests/unidade/` to `tests/unit/` before updating the config produced
 * "No test files found, exiting with code 0". A guard that *derives* its expectations from
 * vitest.config.ts would have "learned" the same wrong glob from the same edit and approved it —
 * it would have been checking that vitest agrees with itself, which is always true. Declaring the
 * list here, by hand, means an edit to vitest.config.ts that deletes or breaks a project has to
 * also survive a comparison against a file nobody touched, or this guard fails.
 *
 * Each entry's `reason` (for `empty-by-design` projects) lives here, in code, on purpose —
 * AGENTS.md's comment rule ("say where the guardrail ends") applies to exemptions from a guard
 * just as much as to the guard itself, and whoever edits vitest.config.ts next sees it right
 * where the check that would stop them lives, not in a doc they'd have to know to open first.
 */

export type ProjectExpectation =
  | { readonly kind: 'has-tests' }
  | {
      readonly kind: 'empty-by-design';
      /** Why zero test files is correct today, not a bug — read this before "fixing" a red guard. */
      readonly reason: string;
      /** Plan task (docs/PLANO-DE-ENTREGA.md) expected to give this project its first test file. */
      readonly filledBy: string;
    };

export interface DeclaredProject {
  readonly name: string;
  readonly expectation: ProjectExpectation;
}

/**
 * The 5 projects from vitest.config.ts. As of S1-T0e, `integration` and `e2e` both legitimately
 * resolve to zero files — not just `e2e` as originally written in the S1-T0e plan entry before
 * anyone counted (corrected there in the same change that added this guard). When a project here
 * goes from `empty-by-design` to `has-tests` for real, `test-projects.test.ts` starts failing
 * for that entry until this file is updated to match — that's requirement (b), the direction
 * nobody tests by hand.
 */
export const DECLARED_PROJECTS: readonly DeclaredProject[] = [
  { name: 'unit', expectation: { kind: 'has-tests' } },
  {
    name: 'integration',
    expectation: {
      kind: 'empty-by-design',
      reason:
        'tests/integration/ only has files under guards/ today, and the `integration` project ' +
        'excludes that subtree by design (guards/ writes fixtures into the real src/ tree and ' +
        'runs as its own project below, see the `guards` project comment in vitest.config.ts). ' +
        'The real adapter integration suites (discovery/, storage/, git/, process/, ' +
        'notification/, generation/) have not landed yet.',
      filledBy: 'S1-T2',
    },
  },
  { name: 'guards', expectation: { kind: 'has-tests' } },
  {
    name: 'e2e',
    expectation: {
      kind: 'empty-by-design',
      reason:
        'tests/e2e/ runs the compiled seeya binary against real CLI commands; none of those ' +
        'commands exist yet.',
      filledBy: 'S1-T6',
    },
  },
  { name: 'contract', expectation: { kind: 'has-tests' } },
];
