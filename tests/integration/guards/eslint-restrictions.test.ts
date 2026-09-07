import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_ROOT,
  TEST_TIMEOUT_MS,
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
 * process, and deletes the file in `afterEach`, even if the assertion fails. `TEST_TIMEOUT_MS`
 * (S0-T6, split from the child's own budget in S2-T7) because Vitest's default 5s times out
 * under load when spawning the real eslint — this file's real `eslint` invocations are the
 * slowest of any guard, measured up to ~12s under a loaded machine (`_support.ts`'s
 * `CHILD_PROCESS_BUDGET_MS` comment has the full measurement).
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
  );
});

/**
 * D-038 (S4-T9, closing Q-059 item 3): every process the `seeya` launches is invisible by
 * default, enforced by banning `spawn` imported straight from `node:child_process` outside
 * `adapters/process/spawn.ts` (the `spawnHidden` wrapper) and its three declared exceptions —
 * same `no-restricted-imports` technique as this file's "rejects node:* imported in src/core/"
 * case above, this time scoped by `importNames` instead of a `node:*` group pattern.
 *
 * The rejection cases use temp fixtures under `_guard-eslint/`, same as the rest of this file.
 * The approval cases for the wrapper and its three exceptions run eslint against the REAL
 * production files instead of a fixture: the ignore list in eslint.config.js names those four
 * files by their exact path (`src/adapters/process/spawn.ts`, etc — not a directory glob, on
 * purpose, so a fixture placed in ANY `_guard-eslint/` subdirectory can never match it and no
 * other file can borrow the exemption by being named `spawn.ts` somewhere else). Proving the
 * exemption is real means pointing eslint at those literal paths, exactly the way `npm run
 * verificar`'s real `eslint .` invocation would.
 */
describe('guard: eslint rejects spawn imported straight from node:child_process outside the D-038 wrapper and its exceptions', () => {
  const created: string[] = [];

  afterEach(() => {
    for (const createdPath of created.splice(0)) {
      deleteTempFile(createdPath);
    }
  });

  afterAll(() => {
    cleanUpGuardResidue(GUARD_NAME);
  });

  it(
    'rejects spawn imported from node:child_process in an ordinary adapter, with a message pointing at spawnHidden',
    () => {
      const filePath = writeTempFile(
        guardFixturePath(GUARD_NAME, 'adapters/generation', 'violation-test-spawn.ts'),
        "import { spawn } from 'node:child_process';\nexport const child = spawn('echo', ['hi']);\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-imports');
      expect(result.output).toContain('spawnHidden');
      expect(result.output).toContain('D-038');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects an aliased spawn import (import { spawn as run }) the same way — importNames matches the original export name, not the local alias',
    () => {
      const filePath = writeTempFile(
        guardFixturePath(GUARD_NAME, 'application', 'violation-test-spawn-alias.ts'),
        "import { spawn as run } from 'node:child_process';\nexport const child = run('echo', ['hi']);\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).not.toBe(0);
      expect(result.output).toContain('no-restricted-imports');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'approves importing spawnHidden from adapters/process/spawn.ts elsewhere in src/ (control: the guard targets node:child_process, not the word "spawn")',
    () => {
      const filePath = writeTempFile(
        guardFixturePath(GUARD_NAME, 'adapters/generation', 'control-test-spawn-hidden.ts'),
        // Two levels up: this fixture lives in adapters/generation/_guard-eslint/, one directory
        // deeper than the real call sites (e.g. spawn-claude.ts, which sits directly in
        // adapters/generation/ and imports '../process/spawn.js').
        "import { spawnHidden } from '../../process/spawn.js';\nexport const child = spawnHidden('echo', ['hi']);\n",
      );
      created.push(filePath);

      const result = runEslint([filePath]);

      expect(result.exitCode, result.output).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'approves the real adapters/process/spawn.ts wrapper importing spawn directly (control for the exemption)',
    () => {
      const result = runEslint([path.join(PROJECT_ROOT, 'src/adapters/process/spawn.ts')]);

      expect(result.exitCode, result.output).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'approves the real daemon-launch.ts, termination-posix.ts and spawn-interactive.ts (the three declared D-038 exceptions)',
    () => {
      const result = runEslint(
        [
          'src/adapters/process/daemon-launch.ts',
          'src/adapters/process/termination-posix.ts',
          'src/adapters/resumption/spawn-interactive.ts',
        ].map((relativePath) => path.join(PROJECT_ROOT, relativePath)),
      );

      expect(result.exitCode, result.output).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
