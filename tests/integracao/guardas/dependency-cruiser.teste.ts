import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  SYNTHETIC_TEST_LAYER_NAME,
  PROJECT_ROOT,
  CHILD_PROCESS_TIMEOUT,
  deleteTempFile,
  guardFixturePath,
  writeTempFile,
  cleanUpGuardResidue,
  runDependencyCruiser,
  runDependencyCruiserOnFullTree,
  violationsOfFixture,
  violationsOutsideGuardFixtures,
} from './_support.js';

const GUARD_NAME = 'dependency-cruiser';

/** Shortcut for a fixture path in this file, always isolated in src/<layer>/_guarda-dependency-cruiser/. */
function fixture(layerDir: string, fileName: string): string {
  return guardFixturePath(GUARD_NAME, layerDir, fileName);
}

/**
 * Proves that dependency-cruiser REJECTS every layer rule from the "From → To" table in
 * docs/ARQUITETURA.md / D-020 (S0-T2, closed in S0-T6).
 *
 * Each test writes a file (violating or not) inside the real src/ tree — the same tree the real
 * command (`npm run dependencias`, called by `npm run verificar` and by CI) scans — runs the real
 * tool as a child process, and deletes the file in `afterEach`, even if the assertion fails. No
 * violation stays permanently in the repo.
 *
 * S1-T0: each test's fixture lives in `src/<layer>/_guarda-dependency-cruiser/`, a subdirectory
 * reserved for THIS test file (never shared with layer-matrix.teste.ts or
 * eslint-restrictions.teste.ts). And, even more importantly: each test tells dependency-cruiser to
 * analyze ONLY its own fixture (`runDependencyCruiser([path])`), not all of `src/` —
 * dependency-cruiser resolves and follows imports from there, so the result only speaks to what
 * the test wrote, never to what another test file is doing in parallel in another layer. The only
 * test that needs to scan all of `src/` (because it has no fixture of its own) is "approves the
 * real tree, no violation" — see `runDependencyCruiserOnFullTree` in `_support.ts`.
 *
 * Includes the test for D-020's allowed side (cli/ importing adaptadores/ — cli/ is the only
 * composition root) and, starting at S0-T6, a control for each of the matrix's 8 allowed pairs:
 * without them, a rule could later be tightened too much and break the composition root without
 * anyone noticing, same reasoning as D-019's allowed case.
 *
 * See also layer-matrix.teste.ts: the "guard of the guard" that scans the matrix's 20
 * ordered pairs from a single data structure, instead of relying only on these manual tests.
 */
describe('guard: dependency-cruiser rejects a layer violation', () => {
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
    'approves the real tree, no violation (control)',
    () => {
      const result = runDependencyCruiserOnFullTree();
      expect(result.jsonValid, result.raw).toBe(true);

      const realViolations = violationsOutsideGuardFixtures(result.violations);
      expect(realViolations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects nucleo/ importing node:*',
    () => {
      const filePath = fixture('nucleo', 'violation-test-node.ts');
      created.push(
        writeTempFile(
          filePath,
          "import { readFileSync } from 'node:fs';\nexport const content = readFileSync('x');\n",
        ),
      );

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('nucleo-nao-importa-node');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects nucleo/ importing another layer of the project',
    () => {
      const filePath = fixture('nucleo', 'violation-test-layer.ts');
      created.push(
        writeTempFile(filePath, "import '../../adaptadores/relogio/index.js';\nexport {};\n"),
      );

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('nucleo-nao-importa-outras-camadas');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects adaptadores/ importing aplicacao/',
    () => {
      const filePath = fixture('adaptadores/relogio', 'violation-test-aplicacao.ts');
      created.push(writeTempFile(filePath, "import '../../../aplicacao/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects adaptadores/ importing cli/',
    () => {
      const filePath = fixture('adaptadores/relogio', 'violation-test-cli.ts');
      created.push(writeTempFile(filePath, "import '../../../cli/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects adaptadores/ importing agendador/',
    () => {
      const filePath = fixture('adaptadores/relogio', 'violation-test-agendador.ts');
      created.push(writeTempFile(filePath, "import '../../../agendador/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves adaptadores/ importing nucleo/ (control: implements the port)',
    () => {
      const filePath = fixture('adaptadores/relogio', 'control-test-nucleo.ts');
      created.push(writeTempFile(filePath, "import '../../../nucleo/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const violations = violationsOfFixture(result.violations, filePath);

      expect(violations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects aplicacao/ importing cli/',
    () => {
      const filePath = fixture('aplicacao', 'violation-test-cli.ts');
      created.push(writeTempFile(filePath, "import '../../cli/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects aplicacao/ importing agendador/',
    () => {
      const filePath = fixture('aplicacao', 'violation-test-agendador.ts');
      created.push(writeTempFile(filePath, "import '../../agendador/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects aplicacao/ importing adaptadores/ (D-020: only cli/ names a concrete adapter)',
    () => {
      const filePath = fixture('aplicacao', 'violation-test-adaptadores.ts');
      created.push(writeTempFile(filePath, "import '../../adaptadores/git/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves aplicacao/ importing nucleo/ (control)',
    () => {
      const filePath = fixture('aplicacao', 'control-test-nucleo.ts');
      created.push(writeTempFile(filePath, "import '../../nucleo/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const violations = violationsOfFixture(result.violations, filePath);

      expect(violations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects agendador/ importing adaptadores/ (D-020: receives injection from cli/)',
    () => {
      const filePath = fixture('agendador', 'violation-test-adaptadores.ts');
      created.push(writeTempFile(filePath, "import '../../adaptadores/git/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('agendador-nao-importa-adaptadores');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects agendador/ importing cli/ (D-020: cli/ is what injects the scheduler, never the other way)',
    () => {
      const filePath = fixture('agendador', 'violation-test-cli.ts');
      created.push(writeTempFile(filePath, "import '../../cli/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePath).map((v) => v.rule);

      expect(rules, result.raw).toContain('agendador-nao-importa-cli');
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves agendador/ importing nucleo/ (control)',
    () => {
      const filePath = fixture('agendador', 'control-test-nucleo.ts');
      created.push(writeTempFile(filePath, "import '../../nucleo/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const violations = violationsOfFixture(result.violations, filePath);

      expect(violations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves agendador/ importing aplicacao/ (control: agendador orchestrates aplicacao/ over time)',
    () => {
      const filePath = fixture('agendador', 'control-test-aplicacao.ts');
      created.push(writeTempFile(filePath, "import '../../aplicacao/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const violations = violationsOfFixture(result.violations, filePath);

      expect(violations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves cli/ importing adaptadores/ (control: cli/ is the only composition root, D-020)',
    () => {
      const filePath = fixture('cli', 'control-test-adaptadores.ts');
      created.push(writeTempFile(filePath, "import '../../adaptadores/git/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const violations = violationsOfFixture(result.violations, filePath);

      expect(violations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves cli/ importing nucleo/ (control)',
    () => {
      const filePath = fixture('cli', 'control-test-nucleo.ts');
      created.push(writeTempFile(filePath, "import '../../nucleo/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const violations = violationsOfFixture(result.violations, filePath);

      expect(violations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves cli/ importing aplicacao/ (control)',
    () => {
      const filePath = fixture('cli', 'control-test-aplicacao.ts');
      created.push(writeTempFile(filePath, "import '../../aplicacao/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const violations = violationsOfFixture(result.violations, filePath);

      expect(violations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'approves cli/ importing agendador/ (control: cli/ builds and injects the scheduler)',
    () => {
      const filePath = fixture('cli', 'control-test-agendador.ts');
      created.push(writeTempFile(filePath, "import '../../agendador/index.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePath]);
      expect(result.jsonValid, result.raw).toBe(true);
      const violations = violationsOfFixture(result.violations, filePath);

      expect(violations, result.raw).toEqual([]);
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'does not reject src/aplicacao-legado/ by mistake (segment anchoring, S0-T6): ' +
      '^src/aplicacao without an anchor would match this prefix and block a layer that does not even exist',
    () => {
      const filePath = fixture(SYNTHETIC_TEST_LAYER_NAME, 'anchoring-test.ts');
      writeTempFile(filePath, "import '../../adaptadores/git/index.js';\nexport {};\n");
      try {
        const result = runDependencyCruiser([filePath]);
        expect(result.jsonValid, result.raw).toBe(true);
        const violations = violationsOfFixture(result.violations, filePath);

        expect(violations, result.raw).toEqual([]);
      } finally {
        rmSync(path.join(PROJECT_ROOT, 'src', SYNTHETIC_TEST_LAYER_NAME), {
          recursive: true,
          force: true,
        });
      }
    },
    CHILD_PROCESS_TIMEOUT,
  );

  it(
    'rejects a dependency cycle between two modules',
    () => {
      const filePathA = fixture('adaptadores/relogio', 'cycle-test-a.ts');
      const filePathB = fixture('adaptadores/relogio', 'cycle-test-b.ts');
      created.push(writeTempFile(filePathA, "import './cycle-test-b.js';\nexport {};\n"));
      created.push(writeTempFile(filePathB, "import './cycle-test-a.js';\nexport {};\n"));

      const result = runDependencyCruiser([filePathA, filePathB]);
      expect(result.jsonValid, result.raw).toBe(true);
      const rules = violationsOfFixture(result.violations, filePathA).map((v) => v.rule);

      expect(rules, result.raw).toContain('sem-dependencia-circular');
    },
    CHILD_PROCESS_TIMEOUT,
  );
});
