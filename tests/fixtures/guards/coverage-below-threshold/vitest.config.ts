import { defineConfig } from 'vitest/config';

/**
 * Isolated fixture used by tests/integracao/guardas/cobertura.teste.ts to prove that the
 * per-directory coverage threshold (docs/TESTES.md, really configured in the root
 * vitest.config.ts) rejects when the suite doesn't cover enough. Not part of the project's real
 * suite: neither "sut.ts" nor "sut.teste.ts" live under src/ or under
 * tests/unidade|integracao, so they aren't collected by mistake by the real `npm test`/`npm run
 * cobertura`.
 */
export default defineConfig({
  test: {
    include: ['sut.teste.ts'],
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
