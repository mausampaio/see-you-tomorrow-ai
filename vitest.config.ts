import { configDefaults, defineConfig } from 'vitest/config';

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
          // guardas/ tem projeto próprio (ver abaixo) porque precisa rodar em sequência; o
          // resto de integracao/ (descoberta/, armazenamento/, git/, processo/, notificacao/ a
          // partir do Sprint 1) usa tmpdir isolado por teste e não disputa recurso nenhum, então
          // mantém o paralelismo padrão do Vitest.
          exclude: [...configDefaults.exclude, 'tests/integracao/guardas/**'],
        },
      },
      {
        test: {
          name: 'guardas',
          include: ['tests/integracao/guardas/**/*.teste.ts'],
          // Os guards escrevem fixtures na árvore real de src/ e rodam eslint/depcruise de
          // verdade contra ela inteira (scan completo, não por arquivo) — por isso disputam o
          // mesmo recurso mutável real e têm que rodar em sequência. O resto de integracao/ usa
          // tmpdir isolado por teste e não disputa nada (projeto separado acima, com
          // paralelismo padrão). Ver S0-T6 em docs/PLANO-DE-ENTREGA.md.
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
          /**
           * Escreve a versão do Claude Code instalada direto no stdout antes de qualquer teste
           * rodar — é o que garante docs/TESTES.md ("registrar sempre a versão") no caminho
           * feliz do reporter padrão, que não imprime nome de teste quando tudo passa. Ver
           * tests/contrato/_versao-global-setup.ts.
           */
          globalSetup: ['tests/contrato/_versao-global-setup.ts'],
        },
      },
    ],
  },
});
