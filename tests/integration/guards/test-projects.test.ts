import { describe, expect, it } from 'vitest';
import rawViteConfig from '../../../vitest.config.js';
import { TEST_TIMEOUT_MS, isRecord, listProjectTestFiles } from './_support.js';
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
 *    entry here fails loudly instead of running unchecked, and so does one added without a
 *    readable name at all (`realProjectName` refuses to guess at a name vitest would derive on
 *    its own); a leftover entry for a removed project fails too.
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
  return rawConfig.test.projects.map((project, index) => realProjectName(project, index));
}

/**
 * Reduces one `test.projects[]` entry to its name — or throws, never skips (found in review).
 * Vitest accepts two shapes here that the earlier version of this function silently dropped: a
 * glob STRING pointing at another config file, and an inline object with no `name` at all (in
 * which case vitest derives one from the array index, e.g. `"0"`). Both are real projects that
 * really run real tests. Dropping either silently made `extractRealProjectNames` under-count,
 * which made the set-comparison test above blind to a whole track added this way — verified by
 * execution: adding `{ test: { include: [...] } }` with no `name` made the guard pass while
 * vitest itself collected and would run that project's tests. That's requirement (c) failing in
 * exactly the silent way S1-T0e exists to close, just one level removed from the original bug.
 *
 * Failing closed instead (same doctrine as the stage reader in
 * scripts/verificar-termos-locais.mjs: "não dá para verificar: falha fechada"): whoever hits this
 * error almost certainly added a project legitimately and needs to know to give it an explicit
 * name and declare that name in `_test-projects.ts` — not that this guard is broken.
 */
function realProjectName(project: unknown, index: number): string {
  if (isRecord(project) && isRecord(project.test) && typeof project.test.name === 'string') {
    return project.test.name;
  }
  throw new Error(
    `vitest.config.ts's test.projects[${index}] has no explicit { test: { name: '...' } } ` +
      `this guard can read (got ${JSON.stringify(project)}). Vitest would still run it — either ` +
      `as a string reference to another config file, or under a name it derives from the array ` +
      `index (e.g. "${index}") — so this guard refuses to guess and treats it as unresolved ` +
      `instead of silently absent. Give the project an explicit name in vitest.config.ts, then ` +
      `declare that same name in _test-projects.ts's DECLARED_PROJECTS.`,
  );
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
    TEST_TIMEOUT_MS,
  );
}
