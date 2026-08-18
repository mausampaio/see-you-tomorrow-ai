import { describe, expect, it } from 'vitest';
import rawViteConfig from '../../../vitest.config.js';
import { CHILD_PROCESS_TIMEOUT, isRecord, listProjectTestFiles } from './_support.js';
import { DECLARED_PROJECTS, type DeclaredProject } from './_test-projects.js';

/**
 * Closes S1-T0e: `passWithNoTests: true` is global in vitest.config.ts (S0-T1), which means any
 * project whose `include` glob stops matching anything now exits 0 without running a single
 * test — a false green, not a skip. Reproduced during S1-T0d: renaming `tests/unidade/` to
 * `tests/unit/` before updating the config produced "No test files found, exiting with code 0".
 * The gate would have approved a half-finished migration.
 *
 * `_test-projects.ts` declares, independently of vitest.config.ts, which projects are expected
 * to have at least one test file today and which are legitimately empty (and why, and until
 * when). This file enforces that declaration against reality, in both directions:
 *
 * 1. every project declared `has-tests` really resolves at least one file — the failure that
 *    motivated this task;
 * 2. every project declared `empty-by-design` really resolves zero — so the exemption a track
 *    needed while its adapters didn't exist yet doesn't quietly outlive them once real tests
 *    land there;
 * 3. the two SETS of project names — declared in `_test-projects.ts`, and the real ones read
 *    from vitest.config.ts below — match exactly. A project added to vitest.config.ts without an
 *    entry here fails loudly instead of running unchecked; a leftover entry for a removed
 *    project fails too.
 */
describe('guard: no vitest project silently resolves to the wrong test-file count', () => {
  it("the declared project list matches vitest.config.ts's real project set exactly", () => {
    const declaredNames = DECLARED_PROJECTS.map((project) => project.name).sort();
    const realNames = extractRealProjectNames(rawViteConfig).sort();

    expect(declaredNames).toEqual(realNames);
  });

  for (const project of DECLARED_PROJECTS) {
    testProject(project);
  }
});

/**
 * Reads `vitest.config.ts`'s default export like external data, not a trusted internal object —
 * `test.projects` is typed by vitest as an array of inline project configs OR glob strings
 * pointing at other config files, so narrowing it defensively (rather than trusting a type
 * assertion) is the correct read here, not just this file's usual caution. Deliberately reuses
 * `isRecord` from `_support.ts` instead of `any`/`as`, same as this suite already does for
 * dependency-cruiser's JSON output.
 */
function extractRealProjectNames(rawConfig: unknown): string[] {
  if (
    !isRecord(rawConfig) ||
    !isRecord(rawConfig.test) ||
    !Array.isArray(rawConfig.test.projects)
  ) {
    throw new Error(
      "vitest.config.ts's shape changed in a way this guard doesn't understand: expected " +
        `{ test: { projects: [...] } }, got ${JSON.stringify(rawConfig)}`,
    );
  }
  const names: string[] = [];
  for (const project of rawConfig.test.projects) {
    if (isRecord(project) && isRecord(project.test) && typeof project.test.name === 'string') {
      names.push(project.test.name);
    }
  }
  return names;
}

function testProject(project: DeclaredProject): void {
  const expectation = project.expectation;
  const description =
    expectation.kind === 'has-tests'
      ? `${project.name}: resolves at least one test file`
      : `${project.name}: resolves exactly zero test files (empty by design until ` +
        `${expectation.filledBy} — ${expectation.reason})`;

  it(
    description,
    () => {
      const result = listProjectTestFiles(project.name);
      // A parse failure (e.g. the name doesn't exist in vitest.config.ts at all) is NOT the
      // same as "zero files" — see listProjectTestFiles's docstring. Failing this first keeps a
      // tool-level problem from being silently read as either kind of pass below.
      expect(result.jsonValid, result.raw).toBe(true);

      if (expectation.kind === 'has-tests') {
        expect(result.files.length, result.raw).toBeGreaterThan(0);
      } else {
        expect(result.files.length, result.raw).toBe(0);
      }
    },
    CHILD_PROCESS_TIMEOUT,
  );
}
