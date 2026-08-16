import { defineConfig } from 'vitest/config';

/**
 * Projetos de teste separados por faixa (ver docs/TESTES.md). `unidade` e `integracao` rodam em
 * `npm test`; `e2e` e `contrato` são opt-in via `npm run test:e2e` / `npm run test:contrato`.
 * Todos podem estar vazios nesta tarefa (S0-T1) — `passWithNoTests` (opção global, não por
 * projeto) evita falha por ausência de teste numa faixa que ainda não tem nenhum.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unidade',
          include: ['tests/unidade/**/*.teste.ts'],
        },
      },
      {
        test: {
          name: 'integracao',
          include: ['tests/integracao/**/*.teste.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.teste.ts'],
        },
      },
      {
        test: {
          name: 'contrato',
          include: ['tests/contrato/**/*.teste.ts'],
        },
      },
    ],
  },
});
