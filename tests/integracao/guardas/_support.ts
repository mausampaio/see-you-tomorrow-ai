import { mkdirSync, readdirSync, rmSync, writeFileSync, type Dirent } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Common support for tests/integracao/guardas/*.teste.ts. Not a test file itself (doesn't end in
 * `.teste.ts`), just a utility imported by them.
 *
 * Every guard is invoked as a real child process — never by calling the tool's API in-process —
 * because what this test set proves is that the command that runs in `npm run verificar` and in
 * CI fails, not that some internal function would.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..', '..', '..');

/**
 * Timeout (ms) for tests that spawn eslint/depcruise as a real child process. Vitest's default
 * 5s times out under load (busy CI, slow disk) and produces an intermittent failure with no
 * relation to the rule being tested — observed in the S0-T2 review. Pass this as the third
 * argument of `it(...)` in any test that calls `runEslint` or `runDependencyCruiser`.
 */
export const CHILD_PROCESS_TIMEOUT = 20_000;

export interface CommandResult {
  exitCode: number | null;
  output: string;
}

function run(args: readonly string[], options?: { cwd?: string }): CommandResult {
  const result = spawnSync(process.execPath, [...args], {
    cwd: options?.cwd ?? PROJECT_ROOT,
    encoding: 'utf8',
    shell: false,
  });
  return {
    exitCode: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/** Runs the real eslint (the binary installed in node_modules) against the given paths. */
export function runEslint(absolutePaths: readonly string[]): CommandResult {
  const binary = path.join(PROJECT_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
  return run([binary, '--no-color', ...absolutePaths]);
}

export interface DependencyCruiserViolation {
  readonly rule: string;
  readonly from: string;
  readonly to: string;
}

export interface DependencyCruiserResult {
  /** The reported violations (S1-T0: never use global count/exit code — see violationsOfFixture). */
  readonly violations: readonly DependencyCruiserViolation[];
  /**
   * `false` when the process output couldn't be parsed as the JSON that `--output-type json`
   * should produce (e.g. dependency-cruiser printed an I/O error instead of the report — see
   * `runDependencyCruiserOnFullTree`). In that case `violations` comes back empty but that does
   * NOT mean "no violation": it means "couldn't tell". Every test that expects an empty list
   * needs to check this first, or a tool failure passes as approval (S1-T0).
   */
  readonly jsonValid: boolean;
  /** Raw output (JSON or error) from the process, only for diagnostics in a failure message (S1-T0). */
  readonly raw: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extracts `summary.violations[]` from the JSON that `dependency-cruise --output-type json`
 * prints. Doesn't use `any`: every field is checked before being read. If the format changes or
 * parsing fails, returns `jsonValid: false` — never pretends "couldn't read it" is the same as
 * "zero violations" (S1-T0, plan item 3: `raw` is available in the test's failure message).
 */
function extractViolations(jsonOutput: string): {
  violations: DependencyCruiserViolation[];
  jsonValid: boolean;
} {
  try {
    const data: unknown = JSON.parse(jsonOutput);
    if (!isRecord(data) || !isRecord(data.summary) || !Array.isArray(data.summary.violations)) {
      return { violations: [], jsonValid: false };
    }
    const violations: DependencyCruiserViolation[] = [];
    for (const item of data.summary.violations as unknown[]) {
      if (
        isRecord(item) &&
        typeof item.from === 'string' &&
        typeof item.to === 'string' &&
        isRecord(item.rule) &&
        typeof item.rule.name === 'string'
      ) {
        violations.push({ from: item.from, to: item.to, rule: item.rule.name });
      }
    }
    return { violations, jsonValid: true };
  } catch {
    return { violations: [], jsonValid: false };
  }
}

/**
 * Runs the real dependency-cruiser, with the project's real config, asking for JSON output
 * (`--output-type json`) instead of the human text the real command (`npm run dependencias`)
 * uses — only the test call changes, the rule stays the same.
 *
 * `entries` (S1-T0): every test that writes its OWN fixture passes `[fixturePath]` (or the few
 * relevant paths, like the cycle test) — never the whole `src`. Analyzing only the fixture (which
 * dependency-cruiser resolves and follows the imports of) instead of all of `src` has two
 * advantages over just filtering the result afterward: (1) the test never sees another test
 * file's violation while running in parallel, because it never visits its files; (2) it
 * eliminates a subtler race observed in S1-T0 — dependency-cruiser scanning a DIRECTORY can list
 * a temp file from ANOTHER test file and, an instant later, try to open it to analyze; if that
 * other test has already deleted its own fixture in the meantime (a normal `afterEach`, nothing
 * wrong with it), dependency-cruiser reports an I/O error instead of the report. That's why this
 * function never accepts a directory as input — whoever needs the whole real tree uses
 * `runDependencyCruiserOnFullTree`, which already hands over a list of FILES (never the `src`
 * directory) to avoid reopening that same problem.
 */
export function runDependencyCruiser(entries: readonly string[]): DependencyCruiserResult {
  const binary = path.join(
    PROJECT_ROOT,
    'node_modules',
    'dependency-cruiser',
    'bin',
    'dependency-cruise.mjs',
  );
  const result = run([
    binary,
    ...entries,
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'json',
  ]);
  const { violations, jsonValid } = extractViolations(result.output);
  return { violations, jsonValid, raw: result.output };
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

/**
 * `readdirSync(directory)`, or an empty list if the directory disappeared between the parent
 * listing that entry and this call trying to read its contents.
 *
 * S1-T0, second round: the first version of `listProductionTsFiles` called `readdirSync`
 * directly, without tolerating this, and the PO reproduced the suite (not the test — the SUITE)
 * crashing with `ENOENT: ... scandir`. The TOCTOU hadn't been eliminated from dependency-cruiser:
 * it had been MOVED one level up, to this scan. E.g. the test "doesn't reject
 * src/application-legacy/ by mistake" (dependency-cruiser.teste.ts) creates `src/application-legacy/`
 * and deletes the whole directory in `finally` — if this scan, running in parallel, lists `src/`
 * and sees `application-legacy` in time, but only gets to read its CONTENTS after that `finally` has
 * already run, the recursive `readdirSync` in here blows up.
 *
 * Why tolerating this is the CORRECT answer and not a lazy `catch` hiding instability (the same
 * trap as the retry we already discarded): the only kind of directory that can vanish mid-scan is
 * a transient artifact from another guard test file — either a `_guarda-*` (which we already skip
 * by name anyway) or a whole synthetic layer like `application-legacy/`, created and deleted by a
 * single test. No real PRODUCTION directory is ever deleted during the suite. So "disappeared
 * between me listing the parent and me trying to read it" is, by definition, "not production" —
 * returning an empty list for that branch is the semantically correct read, not fault tolerance.
 *
 * That's why the `catch` checks the error's `code`: only ENOENT becomes an empty list. Any other
 * error (permission, disk full, whatever) keeps blowing up — if the scan really fails, the guard
 * has to scream, not pretend everything's fine.
 */
function listEntriesOrEmpty(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorWithCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }
}

/**
 * Lists (recursively, paths relative to the project root, always with `/`) every PRODUCTION
 * `.ts` inside `directory`, skipping entirely any guard fixture subdirectory (`_guarda-*`, see
 * `guardSubdirectory`) — and tolerating a (test, never production) directory that vanishes
 * mid-scan, see `listEntriesOrEmpty`.
 */
function listProductionTsFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of listEntriesOrEmpty(directory)) {
    if (entry.name.startsWith('_guarda-')) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...listProductionTsFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      result.push(path.relative(PROJECT_ROOT, absolutePath).split(path.sep).join('/'));
    }
  }
  return result;
}

/**
 * Runs dependency-cruiser against the whole real production tree — the only use in this suite
 * that really needs that, for the "approves the real tree, no violation" control (it has no
 * fixture of its own to scope the input like the other tests do).
 *
 * S1-T0, this function's history: the first version passed the `src` DIRECTORY to
 * dependency-cruiser (like the real command does) and failed with an intermittent `ENOENT` — the
 * TOCTOU described in `runDependencyCruiser`. The fix tested first was retrying up to 3 times
 * when the output didn't come back as valid JSON. Actually measured (10 runs with
 * `--file-parallelism`, see the commit): the retry fired in **4 of 10**, and in one of them all 3
 * attempts were exhausted and the test still failed. That's well above what the PO defined as a
 * "reasonable mitigation" (1 in 10) — a retry hiding instability was exactly the problem this
 * task exists to fix, not to reproduce somewhere new. Discarded.
 *
 * The real fix: instead of having dependency-cruiser LIST the directory (and risk listing a file
 * another test deletes an instant later), this function lists the production `.ts` files itself
 * first (`listProductionTsFiles`), skipping every `_guarda-*` subdirectory — and hands
 * dependency-cruiser only that explicit list of FILES. Since no guard fixture ever enters that
 * list, dependency-cruiser never even learns it existed, so it never tries to open it: the TOCTOU
 * disappears by construction, not by retry luck. Only production files are churn-free (nothing
 * besides the guard tests creates/deletes files in `src/` during the suite, and they only touch
 * their own `_guarda-*`), so our own listing doesn't inherit that race.
 */
export function runDependencyCruiserOnFullTree(): DependencyCruiserResult {
  const entries = listProductionTsFiles(path.join(PROJECT_ROOT, 'src'));
  return runDependencyCruiser(entries);
}

/**
 * Violations whose source or destination module is the given fixture (path relative to the
 * project root, e.g. `src/core/_guarda-eslint/x.ts` — dependency-cruiser always reports paths
 * with `/`, even on Windows).
 */
export function violationsOfFixture(
  violations: readonly DependencyCruiserViolation[],
  pathRelativeToProject: string,
): DependencyCruiserViolation[] {
  const target = pathRelativeToProject.split(path.sep).join('/');
  return violations.filter((violation) => violation.from === target || violation.to === target);
}

const GUARD_SUBDIRECTORY_PATTERN = /\/_guarda-[^/]+\//;

/**
 * Violations outside any guard fixture subdirectory (`_guarda-*`, see `guardSubdirectory`). Use:
 * the only test that doesn't write its own fixture ("approves the real tree, no violation") —
 * without this, an in-flight fixture from ANOTHER test file, running in parallel, would make this
 * control fail for a reason that isn't its own (S1-T0).
 */
export function violationsOutsideGuardFixtures(
  violations: readonly DependencyCruiserViolation[],
): DependencyCruiserViolation[] {
  return violations.filter(
    (violation) =>
      !GUARD_SUBDIRECTORY_PATTERN.test(`/${violation.from}`) &&
      !GUARD_SUBDIRECTORY_PATTERN.test(`/${violation.to}`),
  );
}

/** Runs the real vitest with coverage against an isolated fixture. */
export function runVitestWithCoverage(fixtureDirectory: string): CommandResult {
  const binary = path.join(PROJECT_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  return run([binary, 'run', '--coverage'], { cwd: fixtureDirectory });
}

/**
 * Writes a temp file inside the project's real tree (needed for the layer guards, which see
 * paths like `src/core/...`). Returns the absolute path, so the caller can delete it in
 * `afterEach`.
 */
export function writeTempFile(pathRelativeToProject: string, content: string): string {
  const absolutePath = path.join(PROJECT_ROOT, pathRelativeToProject);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
  return absolutePath;
}

/** Deletes a temp file created by writeTempFile. Never throws if it's already gone. */
export function deleteTempFile(absolutePath: string): void {
  rmSync(absolutePath, { force: true });
}

/**
 * Name of the synthetic top-level `src/` directory that `dependency-cruiser.teste.ts` creates and
 * deletes on its own to prove the segment anchoring of D-020/S0-T6 ("doesn't reject
 * src/application-legacy/ by mistake"). Shared here (S1-T0, third review round) so that
 * `layer-matrix.teste.ts` — which lists `src/`'s top-level directories and compares them
 * against the declared layer matrix — knows to filter out EXACTLY this name before comparing,
 * instead of risking a (rare, but real) failure pointing at the wrong place: "the matrix is
 * outdated" when really it's just another test file's fixture, in flight.
 *
 * Why the filter on layer-matrix.teste.ts's side has to be an EXACT name, never a prefix or
 * regex: that test exists to catch a real 6th layer added to src/ without updating the matrix. A
 * broad filter (e.g. `startsWith('application')`) would blind the test to a legitimate layer called
 * `application-new` — we'd trade a rare race for a permanent blind spot, which is worse. An exact
 * name is the only way to exclude just this known synthetic directory without giving up the
 * test's purpose.
 *
 * Don't change the value without reviewing `dependency-cruiser.teste.ts`: the anchoring test
 * depends on the name starting with `application` — it's exactly the prefix an unanchored regex
 * would match by mistake against the real `application/` layer.
 */
export const SYNTHETIC_TEST_LAYER_NAME = 'application-legacy';

/**
 * Name of the subdirectory reserved for ONE guard test file (S1-T0). Each file
 * (`dependency-cruiser.teste.ts`, `layer-matrix.teste.ts`, `eslint-restrictions.teste.ts`)
 * uses a different `guardName` and only writes/cleans inside its own subdirectory — never scans
 * the rest of src/. This is what lets the three run in parallel without one deleting another's
 * in-flight fixture (the original failure: `limparResiduosDeTestesDeGuarda` scanned all of src/
 * deleting any file with the `_` prefix, including another test file's fixture).
 */
export function guardSubdirectory(guardName: string): string {
  return `_guarda-${guardName}`;
}

/**
 * Path (relative to the project root) of a fixture file for the `guardName` guard, inside the
 * `layerDir` layer (relative to src/, e.g. `'adapters/clock'`). E.g.:
 * `guardFixturePath('eslint', 'core', 'control.ts')` →
 * `'src/core/_guarda-eslint/control.ts'`.
 */
export function guardFixturePath(guardName: string, layerDir: string, fileName: string): string {
  return path.join('src', layerDir, guardSubdirectory(guardName), fileName);
}

/**
 * Safety net per test file (S1-T0), for the case where the process is killed mid-test (a CI
 * timeout, for example) before `afterEach` deletes the offending file. Unlike the old scan (every
 * `_` in all of src/), this only deletes the subdirectory reserved for `guardName` — wherever it
 * appears inside src/, since a layer can have more than one occurrence (e.g.
 * `adapters/clock/_guarda-eslint/` and `application/_guarda-eslint/`). Never touches another
 * test file's fixture.
 */
export function cleanUpGuardResidue(guardName: string): void {
  deleteSubdirectoriesNamed(path.join(PROJECT_ROOT, 'src'), guardSubdirectory(guardName));
}

/**
 * S1-T0, third round: this function had the SAME class of bug that `listEntriesOrEmpty` was
 * written to fix in `listProductionTsFiles` — it just survived here, unfixed (found in review).
 * Two things were wrong:
 *
 * 1. Raw `readdirSync`, not tolerating ENOENT — the same TOCTOU: another test file can delete a
 *    subdirectory between this function listing it in the parent and trying to read its
 *    contents.
 * 2. the `existsSync(directory)` before `readdirSync` was itself a check-then-use: between
 *    `existsSync` returning `true` and `readdirSync` running, the directory could vanish — the
 *    `existsSync` protected nothing, it just gave the false impression of protecting.
 *
 * Fixed by reusing `listEntriesOrEmpty` (already tolerates ENOENT the right way — only ENOENT,
 * any other error keeps blowing up) and removing `existsSync`: it's redundant now,
 * `listEntriesOrEmpty` already covers "directory doesn't exist" (including the case it never
 * existed, not only the case it vanished mid-way).
 */
function deleteSubdirectoriesNamed(directory: string, targetName: string): void {
  for (const entry of listEntriesOrEmpty(directory)) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.name === targetName) {
      rmSync(entryPath, { recursive: true, force: true });
    } else {
      deleteSubdirectoriesNamed(entryPath, targetName);
    }
  }
}
