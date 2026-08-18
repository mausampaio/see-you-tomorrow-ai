import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  CHILD_PROCESS_TIMEOUT,
  deleteTempFile,
  guardFixturePath,
  writeTempFile,
  cleanUpGuardResidue,
  runEslint,
} from './_support.js';

const GUARD_NAME = 'eslint';

/** Shortcut for a fixture path in this file, always isolated in src/<layer>/_guard-eslint/. */
function fixture(layerDir: string, fileName: string): string {
  return guardFixturePath(GUARD_NAME, layerDir, fileName);
}

/**
 * Proves that eslint.config.js's boundary rules (S0-T2) really REJECT: `no-restricted-imports`
 * (node:* outside src/core/), `no-restricted-globals` (setTimeout/setInterval outside
 * src/adapters/clock/) and `no-restricted-syntax` (argument-less `new Date()` and
 * `Date.now()` outside src/adapters/clock/ — D-019).
 *
 * D-019 is deliberately narrow: `new Date(valor)` with an argument is a deterministic
 * transformation of data already in hand (parsing a transcript timestamp, for example), not a
 * read of "now" — that's why there's a dedicated test proving it stays APPROVED outside
 * clock/. Without that test, the rule could go back to being too strict without anyone
 * noticing.
 *
 * Each test writes a file (violating or not) in the real tree, runs the real eslint as a child
 * process, and deletes the file in `afterEach`, even if the assertion fails. `CHILD_PROCESS_
 * TIMEOUT` (S0-T6) because Vitest's default 5s times out under load when spawning the real
 * eslint.
 *
 * S1-T0: each fixture lives in `src/<layer>/_guard-eslint/`, a subdirectory reserved for THIS
 * test file — never shared with dependency-cruiser.test.ts or layer-matrix.test.ts.
 * `runEslint` is already given the fixture's exact path (never scans the whole tree), so eslint
 * itself never "sees" another test file's fixture; the real cause of the failure under
 * parallelism was `limparResiduosDeTestesDeGuarda`, which scanned all of src/ by `_` prefix in
 * `afterAll` and could delete another test file's fixture still in flight — hence the
 * `ENOENT`/"No files matching the pattern" observed in the repro. `cleanUpGuardResidue` fixes
 * this by deleting only this file's subdirectory. Every assertion also passes `result.output` as
 * the `expect`'s second message, so a count failure comes with eslint's real messages (plan item
 * 3) instead of just "expected N to be M".
 */
describe('guard: eslint rejects node:* in core/ and non-deterministic time sources outside clock/', () => {
  const created: string[] = [];

  afterEach(() => {
    for (const createdPath of created.splice(0)) {
      deleteTempFile(createdPath);
    }
  });

  // Safety net: if the process is killed mid-test (CI timeout), the afterEach above doesn't
  // run. Deletes only THIS file's fixture subdirectory (S1-T0) — never the whole src/ tree,
  // which would delete another test file's in-flight fixture running in parallel.
  afterAll(() => {
    cleanUpGuardResidue(GUARD_NAME);
  });

  it(
    'approves a clean file in src/core/ (control)',
    () => {
      const filePath = writeTempFile(fixture('core', 'control.ts'), 'export {};\n');
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects node:* imported in src/core/, with a message saying what to do',
    () => {
      const filePath = writeTempFile(
        fixture('core', 'violation-test-node.ts'),
        "import { readFileSync } from 'node:fs';\nexport const content = readFileSync('x');\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-imports');
      expect(result.output).toContain('port declared in core/ports.ts');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects argument-less new Date() outside src/adapters/clock/, with a message saying what to do (D-019)',
    () => {
      const filePath = writeTempFile(
        fixture('application', 'violation-test-date-no-argument.ts'),
        'export const now = new Date();\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-syntax');
      expect(result.output).toContain('Clock port');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects Date.now() outside src/adapters/clock/, with a message saying what to do (D-019)',
    () => {
      const filePath = writeTempFile(
        fixture('application', 'violation-test-date-now.ts'),
        'export const now = Date.now();\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-syntax');
      expect(result.output).toContain('Clock port');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves new Date(value) WITH an argument outside src/adapters/clock/ (D-019, the allowed case)',
    () => {
      const filePath = writeTempFile(
        fixture('application', 'control-test-date-with-argument.ts'),
        "export const commitDate = new Date('2026-01-01');\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves Date.parse(value) outside src/adapters/clock/ (D-019, the allowed case)',
    () => {
      const filePath = writeTempFile(
        fixture('application', 'control-test-date-parse.ts'),
        "export const instant = Date.parse('2026-01-01');\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects setTimeout outside src/adapters/clock/',
    () => {
      const filePath = writeTempFile(
        fixture('application', 'violation-test-settimeout.ts'),
        'export const id = setTimeout(() => {}, 1000);\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-globals');
      expect(result.output).toContain('Clock port');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects setInterval outside src/adapters/clock/',
    () => {
      const filePath = writeTempFile(
        fixture('application', 'violation-test-setinterval.ts'),
        'export const id = setInterval(() => {}, 1000);\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-globals');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves new Date() and Date.now() inside src/adapters/clock/ (control for the exception)',
    () => {
      const filePath = writeTempFile(
        fixture('adapters/clock', 'control-test-date.ts'),
        'export const now = () => new Date();\nexport const nowMs = () => Date.now();\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    CHILD_PROCESS_TIMEOUT,
  );
});
