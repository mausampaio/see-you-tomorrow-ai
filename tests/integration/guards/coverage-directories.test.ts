import path from 'node:path';
import { describe, expect, it } from 'vitest';
import rawViteConfig from '../../../vitest.config.js';
import { isRecord, listProductionTsFiles, PROJECT_ROOT } from './_support.js';
import {
  DECLARED_COVERAGE_DIRECTORIES,
  type DeclaredCoverageDirectory,
} from './_coverage-directories.js';

/**
 * Closes S1-T12: vitest.config.ts's `coverage.thresholds` used to key `'src/**'` for "every
 * directory except core/" — a glob that matches every instrumented file, so it computed the same
 * number as the unscoped aggregate. Measured the day this was found: `adapters/process` sat at
 * 78.19%, below its own 80% floor, while `'src/**'` read 91.7% (the aggregate, carried by
 * everything else) and the gate passed. The fix, in vitest.config.ts, is one glob key per
 * production directory. This file is what keeps that list honest, the same way
 * `test-projects.test.ts` (S1-T0e) keeps vitest's project list honest and `layer-matrix.test.ts`
 * (S0-T6) keeps the layer matrix honest — same shape of gap, third config file.
 *
 * `_coverage-directories.ts` declares, independently of vitest.config.ts, which directories carry
 * a coverage floor and what it is. This file enforces that declaration against reality, in every
 * direction:
 *
 * 1. every directory `src/` really has (scanned from disk, not read out of any config) is
 *    declared here, either `covered` or `excluded-with-reason` — a real directory nobody declared
 *    would otherwise get zero floor and nothing would say so;
 * 2. the SET of `covered` directories here matches the set of glob keys vitest.config.ts's
 *    `coverage.thresholds` really has — a key added or removed there without a matching edit here
 *    fails loudly instead of running unchecked;
 * 3. the threshold NUMBER declared here for each directory matches the number really configured
 *    — so quietly lowering one directory's floor in vitest.config.ts (without this file agreeing
 *    it should be lower) is visible as a test failure, not a silent pass.
 */
describe('guard: no production directory silently carries zero coverage floor', () => {
  it("the declared directory list matches src/'s real leaf directories exactly", () => {
    const realDirectories = realLeafSourceDirectories();
    const declaredDirectories = DECLARED_COVERAGE_DIRECTORIES.map((entry) => entry.path).sort();

    expect(realDirectories).toEqual(declaredDirectories);
  });

  it("the declared 'covered' directories match vitest.config.ts's real threshold glob keys exactly", () => {
    const realGlobs = extractRealThresholdGlobs(rawViteConfig).sort();
    const declaredGlobs = coveredEntries()
      .map((entry) => globFor(entry.path))
      .sort();

    expect(realGlobs).toEqual(declaredGlobs);
  });

  for (const entry of coveredEntries()) {
    testDeclaredThreshold(entry);
  }
});

/**
 * `src/`'s real directories that directly hold at least one production `.ts` file, as paths
 * relative to `src/` (e.g. `'adapters/process'`). Built from `listProductionTsFiles` (S1-T0,
 * reused here per S1-T12 rather than a second recursive walker) so this inherits the same
 * TOCTOU-safe scan and `_guard-*` exclusion the dependency-cruiser guards already rely on —
 * a guard fixture writing into `src/adapters/clock/_guard-eslint/` mid-run must never be read as
 * a new production directory here.
 */
function realLeafSourceDirectories(): string[] {
  const files = listProductionTsFiles(path.join(PROJECT_ROOT, 'src'));
  const directories = new Set<string>();
  for (const file of files) {
    // `file` is always project-root-relative with `/` (see listProductionTsFiles). Slice past
    // "src/" so entries read the same as _coverage-directories.ts's `path` field.
    const withoutSrcPrefix = file.slice('src/'.length);
    const lastSlash = withoutSrcPrefix.lastIndexOf('/');
    if (lastSlash === -1) {
      throw new Error(
        `found a .ts file directly in src/ with no owning directory: "${file}". Every ` +
          'production file is expected to live inside a layer directory (core/, adapters/<x>/, ' +
          'application/, scheduler/, cli/) — either this is a real new top-level file that needs ' +
          'its own decision, or the scan above picked up something it should not have.',
      );
    }
    directories.add(withoutSrcPrefix.slice(0, lastSlash));
  }
  return [...directories].sort();
}

function coveredEntries(): (DeclaredCoverageDirectory & {
  expectation: { kind: 'covered'; threshold: number };
})[] {
  return DECLARED_COVERAGE_DIRECTORIES.filter(
    (
      entry,
    ): entry is DeclaredCoverageDirectory & {
      expectation: { kind: 'covered'; threshold: number };
    } => entry.expectation.kind === 'covered',
  );
}

function globFor(directoryPath: string): string {
  return `src/${directoryPath}/**`;
}

/**
 * Threshold keys vitest itself treats as something OTHER than a directory glob — copied from
 * `@vitest/coverage-v8`'s own `resolveThresholds` (the keys it skips before treating the rest as
 * globs: `perFile`, `autoUpdate`, the numeric `100` shorthand, and the four bare metric names for
 * a top-level/global threshold). None of these appear in vitest.config.ts's
 * `PRODUCTION_DIRECTORY_THRESHOLDS` today, but filtering them here means a future maintainer
 * adding e.g. `perFile: true` alongside the per-directory globs doesn't make this guard
 * misidentify it as an undeclared 12th directory.
 */
const NON_DIRECTORY_THRESHOLD_KEYS = new Set([
  'perFile',
  'autoUpdate',
  '100',
  'branches',
  'functions',
  'lines',
  'statements',
]);

/**
 * Reads vitest.config.ts's real `test.coverage.thresholds` object like external data, not a
 * trusted internal one — same defensive `isRecord` narrowing `test-projects.test.ts` uses for
 * `test.projects`, for the same reason: a type assertion here would stop protecting the moment
 * the config's shape actually changes, which is exactly when this guard needs to fire.
 */
function extractRealThresholdGlobs(rawConfig: unknown): string[] {
  if (
    !isRecord(rawConfig) ||
    !isRecord(rawConfig.test) ||
    !isRecord(rawConfig.test.coverage) ||
    !isRecord(rawConfig.test.coverage.thresholds)
  ) {
    throw new Error(
      "vitest.config.ts's shape changed in a way this guard doesn't understand: expected " +
        `{ test: { coverage: { thresholds: {...} } } }, got ${JSON.stringify(rawConfig)}`,
    );
  }
  return Object.keys(rawConfig.test.coverage.thresholds).filter(
    (key) => !NON_DIRECTORY_THRESHOLD_KEYS.has(key),
  );
}

/**
 * Reads the four metric numbers real-configured for one glob key, defensively (see
 * `extractRealThresholdGlobs`). Returns `undefined` if the key is missing or malformed — the
 * caller turns that into a test failure with the raw value, never a silent pass.
 */
function realThresholdFor(rawConfig: unknown, glob: string): Record<string, unknown> | undefined {
  if (
    !isRecord(rawConfig) ||
    !isRecord(rawConfig.test) ||
    !isRecord(rawConfig.test.coverage) ||
    !isRecord(rawConfig.test.coverage.thresholds)
  ) {
    return undefined;
  }
  const entry = rawConfig.test.coverage.thresholds[glob];
  return isRecord(entry) ? entry : undefined;
}

function testDeclaredThreshold(
  entry: DeclaredCoverageDirectory & { expectation: { kind: 'covered'; threshold: number } },
): void {
  it(`${entry.path}: vitest.config.ts really enforces ${entry.expectation.threshold}%, for all four metrics`, () => {
    const glob = globFor(entry.path);
    const real = realThresholdFor(rawViteConfig, glob);

    expect(real, `no threshold entry for "${glob}" in vitest.config.ts`).toBeDefined();
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      expect(real?.[metric], `${glob}.${metric}`).toBe(entry.expectation.threshold);
    }
  });
}
