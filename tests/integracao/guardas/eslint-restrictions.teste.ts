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

/** Shortcut for a fixture path in this file, always isolated in src/<layer>/_guarda-eslint/. */
function fixture(layerDir: string, fileName: string): string {
  return guardFixturePath(GUARD_NAME, layerDir, fileName);
}

/**
 * Proves that eslint.config.js's boundary rules (S0-T2) really REJECT: `no-restricted-imports`
 * (node:* outside src/nucleo/), `no-restricted-globals` (setTimeout/setInterval outside
 * src/adaptadores/relogio/) and `no-restricted-syntax` (argument-less `new Date()` and
 * `Date.now()` outside src/adaptadores/relogio/ — D-019).
 *
 * D-019 is deliberately narrow: `new Date(valor)` with an argument is a deterministic
 * transformation of data already in hand (parsing a transcript timestamp, for example), not a
 * read of "now" — that's why there's a dedicated test proving it stays APPROVED outside
 * relogio/. Without that test, the rule could go back to being too strict without anyone
 * noticing.
 *
 * Each test writes a file (violating or not) in the real tree, runs the real eslint as a child
 * process, and deletes the file in `afterEach`, even if the assertion fails. `CHILD_PROCESS_
 * TIMEOUT` (S0-T6) because Vitest's default 5s times out under load when spawning the real
 * eslint.
 *
 * S1-T0: each fixture lives in `src/<layer>/_guarda-eslint/`, a subdirectory reserved for THIS
 * test file — never shared with dependency-cruiser.teste.ts or layer-matrix.teste.ts.
 * `runEslint` is already given the fixture's exact path (never scans the whole tree), so eslint
 * itself never "sees" another test file's fixture; the real cause of the failure under
 * parallelism was `limparResiduosDeTestesDeGuarda`, which scanned all of src/ by `_` prefix in
 * `afterAll` and could delete another test file's fixture still in flight — hence the
 * `ENOENT`/"No files matching the pattern" observed in the repro. `cleanUpGuardResidue` fixes
 * this by deleting only this file's subdirectory. Every assertion also passes `result.output` as
 * the `expect`'s second message, so a count failure comes with eslint's real messages (plan item
 * 3) instead of just "expected N to be M".
 */
describe('guard: eslint rejects node:* in nucleo/ and non-deterministic time sources outside relogio/', () => {
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
    'approves a clean file in src/nucleo/ (control)',
    () => {
      const filePath = writeTempFile(fixture('nucleo', 'control.ts'), 'export {};\n');
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects node:* imported in src/nucleo/, with a message saying what to do',
    () => {
      const filePath = writeTempFile(
        fixture('nucleo', 'violation-test-node.ts'),
        "import { readFileSync } from 'node:fs';\nexport const content = readFileSync('x');\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-imports');
      expect(result.output).toContain('porta declarada em nucleo/portas.ts');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects argument-less new Date() outside src/adaptadores/relogio/, with a message saying what to do (D-019)',
    () => {
      const filePath = writeTempFile(
        fixture('aplicacao', 'violation-test-date-no-argument.ts'),
        'export const now = new Date();\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-syntax');
      expect(result.output).toContain('porta Relogio');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects Date.now() outside src/adaptadores/relogio/, with a message saying what to do (D-019)',
    () => {
      const filePath = writeTempFile(
        fixture('aplicacao', 'violation-test-date-now.ts'),
        'export const now = Date.now();\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-syntax');
      expect(result.output).toContain('porta Relogio');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves new Date(value) WITH an argument outside src/adaptadores/relogio/ (D-019, the allowed case)',
    () => {
      const filePath = writeTempFile(
        fixture('aplicacao', 'control-test-date-with-argument.ts'),
        "export const commitDate = new Date('2026-01-01');\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves Date.parse(value) outside src/adaptadores/relogio/ (D-019, the allowed case)',
    () => {
      const filePath = writeTempFile(
        fixture('aplicacao', 'control-test-date-parse.ts'),
        "export const instant = Date.parse('2026-01-01');\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects setTimeout outside src/adaptadores/relogio/',
    () => {
      const filePath = writeTempFile(
        fixture('aplicacao', 'violation-test-settimeout.ts'),
        'export const id = setTimeout(() => {}, 1000);\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-globals');
      expect(result.output).toContain('porta Relogio');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects setInterval outside src/adaptadores/relogio/',
    () => {
      const filePath = writeTempFile(
        fixture('aplicacao', 'violation-test-setinterval.ts'),
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
    'approves new Date() and Date.now() inside src/adaptadores/relogio/ (control for the exception)',
    () => {
      const filePath = writeTempFile(
        fixture('adaptadores/relogio', 'control-test-date.ts'),
        'export const now = () => new Date();\nexport const nowMs = () => Date.now();\n',
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    CHILD_PROCESS_TIMEOUT,
  );
});
