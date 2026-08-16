import { defineConfig } from 'vitest/config';

/**
 * Fixture isolada usada por tests/integracao/guardas/cobertura.teste.ts para provar que o
 * limite de cobertura por diretório (docs/TESTES.md, configurado de verdade em
 * vitest.config.ts na raiz) reprova quando a suíte não cobre o suficiente. Não faz parte da
 * suíte real do projeto: nem "sut.ts" nem "sut.teste.ts" ficam sob src/ ou sob
 * tests/unidade|integracao, então não são coletados por engano pelo `npm test`/`npm run
 * cobertura` de verdade.
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
