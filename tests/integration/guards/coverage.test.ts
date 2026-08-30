import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_ROOT, TEST_TIMEOUT_MS, runVitestWithCoverage } from './_support.js';

/**
 * Proves that the per-directory coverage threshold (docs/TESTES.md, configured in
 * coverage.thresholds in the root vitest.config.ts) REJECTS when the suite doesn't cover enough
 * — not just that the number shows up in the report.
 *
 * The mechanism tested is exactly the real project's (vitest + v8 provider + thresholds), but
 * pointed at two isolated fixtures in tests/fixtures/guards/ instead of the real src/ tree:
 * writing a deliberately under-covered production file inside src/ and measuring the project's
 * real coverage wouldn't give a deterministic test (the result would depend on everything else
 * that exists in src/ at the time). The fixtures isolate the same mechanics with a minimal
 * subject, one path with 100% coverage and another with a branch left uncovered on purpose.
 *
 * `TEST_TIMEOUT_MS` (S0-T6, split from the child's own budget in S2-T7): also spawns a real
 * child process (a full vitest run with coverage), the same class of flakiness under load as
 * the eslint/depcruise guards.
 */
describe('guard: coverage threshold rejects when coverage is missing', () => {
  it(
    'rejects the fixture with an uncovered branch',
    () => {
      const fixture = path.join(
        PROJECT_ROOT,
        'tests',
        'fixtures',
        'guards',
        'coverage-below-threshold',
      );

      const result = runVitestWithCoverage(fixture);

      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain('does not meet');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'approves the sibling fixture with both branches covered (control)',
    () => {
      const fixture = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'guards', 'sufficient-coverage');

      const result = runVitestWithCoverage(fixture);

      expect(result.exitCode).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
