// Configuração do ESLint (flat config). Ver docs/PLANO-DE-ENTREGA.md S0-T2: regras type-aware
// (recommendedTypeChecked) mais os dois guards de fronteira que o dependency-cruiser não cobre
// sozinho — proibição de node:* em nucleo/ e de Date/setTimeout/setInterval fora de
// adaptadores/relogio/.
import tseslint from 'typescript-eslint';

const MENSAGEM_NODE_NO_NUCLEO =
  'nucleo/ é puro e não pode importar módulos do Node (node:*). Isole o I/O num adaptador ' +
  'atrás de uma porta declarada em nucleo/portas.ts.';

const MENSAGEM_RELOGIO = (nome) =>
  `${nome} só pode ser usado em src/adaptadores/relogio/. Em qualquer outro lugar, use a ` +
  'porta Relogio (nucleo/portas.ts) para obter o instante atual ou agendar algo.';

export default tseslint.config(
  {
    // .dependency-cruiser.cjs é CommonJS de propósito (ver o próprio arquivo) e não faz parte
    // do programa TypeScript do projeto — fica fora do escopo do ESLint type-aware.
    // coverage/** é '**/coverage/**' (não só a da raiz) porque as fixtures de
    // tests/fixtures/guardas/ geram a delas própria ao rodar.
    ignores: ['dist/**', '**/coverage/**', 'node_modules/**', '.dependency-cruiser.cjs'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // allowJs está desligado (de propósito: não queremos .js solto em src/), então nenhum
        // .js na raiz entra de fato no programa do tsc mesmo listado no "include" do
        // tsconfig.json. Os dois arquivos de config em .js do projeto entram aqui.
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'lint-staged.config.js'],
        },
        // Sob allowDefaultProject o programa é criado sem @types/node, então
        // import.meta.dirname fica sem tipo (o valor em si é são — é sempre string).
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- ver comentário acima
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // node:* é proibido só no núcleo — em qualquer outro diretório é normal e necessário.
    files: ['src/nucleo/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: MENSAGEM_NODE_NO_NUCLEO,
            },
          ],
        },
      ],
    },
  },
  {
    // Date/setTimeout/setInterval só existem em adaptadores/relogio/, que implementa a porta
    // Relogio. O restante do projeto (nucleo/, aplicacao/, cli/, os demais adaptadores) usa a
    // porta, nunca o relógio de parede direto.
    files: ['src/**/*.ts'],
    ignores: ['src/adaptadores/relogio/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: MENSAGEM_RELOGIO('Date') },
        { name: 'setTimeout', message: MENSAGEM_RELOGIO('setTimeout') },
        { name: 'setInterval', message: MENSAGEM_RELOGIO('setInterval') },
      ],
    },
  },
);
