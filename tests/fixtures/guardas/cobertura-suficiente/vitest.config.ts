import { defineConfig } from 'vitest/config';

/**
 * Irmã de ../cobertura-abaixo-do-limite/: mesmo sut, mas com os dois ramos cobertos. É o
 * controle positivo — prova que o guard de cobertura não reprova sempre, só quando falta
 * cobertura de verdade.
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
