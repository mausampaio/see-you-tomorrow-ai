import { defineConfig } from 'vitest/config';

/**
 * Sibling of ../coverage-below-threshold/: same sut, but with both branches covered. This is the
 * positive control — it proves the coverage guard doesn't always reject, only when coverage is
 * really missing.
 */
export default defineConfig({
  test: {
    include: ['sut.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['sut.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
