import { defineConfig } from 'vitest/config';

/**
 * Isolated fixture used by tests/integration/guards/coverage.test.ts to prove that the
 * per-directory coverage threshold (docs/TESTES.md, really configured in the root
 * vitest.config.ts) rejects when the suite doesn't cover enough. Not part of the project's real
 * suite: neither "sut.ts" nor "sut.test.ts" live under src/ or under
 * tests/unit|integration, so they aren't collected by mistake by the real `npm test`/`npm run
 * cobertura`.
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
