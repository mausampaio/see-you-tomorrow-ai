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
    /**
     * Cobertura por diretório (docs/TESTES.md): nucleo/ 95%, demais diretórios de produção 80%.
     * Só é medida quando a suíte roda com `--coverage` (script `npm run cobertura`, chamado por
     * `npm run verificar`) — `test:e2e` e `test:contrato` não passam essa flag e não são
     * afetados pelo limite.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/index.ts'],
      thresholds: {
        'src/nucleo/**': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        'src/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
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
          // Os guards de tests/integracao/guardas/ escrevem fixtures na árvore real de src/ e
          // rodam eslint/depcruise de verdade contra ela — inclusive scans da árvore inteira.
          // Com paralelismo de arquivo (padrão do Vitest), um arquivo pode escrever/limpar um
          // fixture enquanto outro está no meio de um scan da mesma árvore, contaminando o
          // resultado (S0-T6: apareceu ao somar matriz-de-camadas.teste.ts aos dois guards já
          // existentes). Arquivos desta faixa compartilham um recurso mutável real, então rodam
          // em sequência.
          fileParallelism: false,
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
