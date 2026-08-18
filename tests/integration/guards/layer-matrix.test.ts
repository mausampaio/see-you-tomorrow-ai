import { readdirSync } from 'node:fs';
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
  violationsOfFixture,
} from './_support.js';
import { LAYERS, type Layer, type LayerPair, orderedPairs } from './_layer-matrix.js';

const GUARD_NAME = 'matriz-de-camadas';

/**
 * The guard of the guard (S0-T6). The three S0-T2 review rounds each found "one more pair nobody
 * listed" — because coverage lived in tests written pair by pair, and "no test" was ambiguous
 * between "forgotten" and "not needed". This file closes that gap: the 20 ordered pairs from
 * docs/ARQUITETURA.md are generated from a single data structure (`_layer-matrix.ts`), never
 * hand-written — and each generated pair runs the real dependency-cruiser against the real src/
 * tree.
 *
 * Two layers of protection:
 *
 * 1. src/'s real directories have to match `LAYERS` exactly. If someone creates a 6th layer in
 *    `src/` without updating `_layer-matrix.ts`, this test fails BEFORE generating any pair
 *    — there's no way for the matrix to stay silently incomplete.
 * 2. For each of the 20 pairs: if the matrix says forbidden, dependency-cruiser has to reject it;
 *    if it says allowed, it has to accept it. A missing rule (should reject and doesn't) and an
 *    overly tight rule (should accept and doesn't) are equally a bug here.
 *
 * S1-T0: each fixture lives in `src/<layer>/_guarda-matriz-de-camadas/`, a subdirectory reserved
 * for THIS file (never shared with dependency-cruiser.test.ts), and dependency-cruiser is called
 * only with THAT fixture as input (`runDependencyCruiser([fixturePath])`), not all of `src/` — the
 * result only speaks to what this test wrote, never to what another test file is doing in
 * parallel in another layer. See `_support.ts` for the detail.
 */
describe('guard: the 20 ordered pairs of the docs/ARQUITETURA.md matrix have complete coverage', () => {
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

  it("the declared layer list matches src/'s real directories (otherwise the matrix is stale)", () => {
    // S1-T0, third review round: dependency-cruiser.test.ts creates and deletes
    // src/application-legacy/ on its own (see SYNTHETIC_TEST_LAYER_NAME in _support.ts) to test
    // dependency-cruiser's segment anchoring. If this listing, running in parallel, catches
    // that directory mid-flight, the failure would point at the WRONG place ("the matrix is
    // stale, missing a 6th layer") when no layer is actually missing — just another test
    // file's fixture, in flight. That's why we filter by EXACT NAME before comparing: never by
    // prefix/regex, because this test exists precisely to catch a real 6th layer, and a broad
    // filter (`startsWith('application')`, for example) would blind the test to a legitimate
    // layer called `application-new` — we'd trade a rare race for a permanent blind spot, which
    // is worse. DO NOT generalize this filter.
    const realDirectories = readdirSync(path.join(PROJECT_ROOT, 'src'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== SYNTHETIC_TEST_LAYER_NAME)
      .sort();
    const declaredLayers = LAYERS.map((layer) => layer.name).sort();

    expect(realDirectories).toEqual(declaredLayers);
  });

  it('the declared matrix has exactly 20 ordered pairs, 12 forbidden and 8 allowed (docs/ARQUITETURA.md)', () => {
    const pairs = orderedPairs();

    expect(pairs).toHaveLength(20);
    expect(pairs.filter((pair) => !pair.allowed)).toHaveLength(12);
    expect(pairs.filter((pair) => pair.allowed)).toHaveLength(8);
  });

  /**
   * Relative import path from the fixture (already inside its `_guarda-matriz-de-camadas`
   * subdirectory, S1-T0) to `to`'s canonical `index.ts`. `fixturePath` is relative to the
   * project root; the calculation's base is the fixture's DIRECTORY, not `from.fixtureDir`
   * directly, because the fixture now lives one level deeper (isolated from the other guard
   * files).
   */
  function importPath(fixturePath: string, to: Layer): string {
    const fromDirAbsolute = path.dirname(path.join(PROJECT_ROOT, fixturePath));
    const toDirAbsolute = path.join(PROJECT_ROOT, 'src', to.targetDir);
    let relative = path.relative(fromDirAbsolute, toDirAbsolute).split(path.sep).join('/');
    if (!relative.startsWith('.')) {
      relative = `./${relative}`;
    }
    return `${relative}/index.js`;
  }

  function testPair(pair: LayerPair): void {
    const label = pair.allowed ? 'allowed' : 'forbidden';
    it(
      `${pair.from.name} → ${pair.to.name} is ${label} [generated from the matrix]`,
      () => {
        const fileName = `${pair.from.name}-to-${pair.to.name}.ts`;
        const fixturePath = guardFixturePath(GUARD_NAME, pair.from.fixtureDir, fileName);
        const content = `import '${importPath(fixturePath, pair.to)}';\nexport {};\n`;
        created.push(writeTempFile(fixturePath, content));

        const result = runDependencyCruiser([fixturePath]);
        expect(result.jsonValid, result.raw).toBe(true);
        const violations = violationsOfFixture(result.violations, fixturePath);

        if (pair.allowed) {
          expect(violations, result.raw).toEqual([]);
        } else {
          expect(violations, result.raw).not.toEqual([]);
        }
      },
      CHILD_PROCESS_TIMEOUT,
    );
  }

  for (const pair of orderedPairs()) {
    testPair(pair);
  }
});
