// Configuração do ESLint (flat config). Ver docs/PLANO-DE-ENTREGA.md S0-T2: regras type-aware
// (recommendedTypeChecked) mais os dois guards de fronteira que o dependency-cruiser não cobre
// sozinho — proibição de node:* em nucleo/ e, fora de adaptadores/relogio/, da fonte
// não-determinística de tempo (D-019: `new Date()` sem argumento, `Date.now()`, setTimeout/
// setInterval). `new Date(valor)` e `Date.parse` continuam livres em qualquer lugar — não são
// leitura do "agora", são transformação determinística de um dado que já se tem.
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
    // A fonte não-determinística de tempo só existe em adaptadores/relogio/, que implementa a
    // porta Relogio (D-019). setTimeout/setInterval são banidos por inteiro — não têm uma forma
    // determinística. Date é mais fino: `new Date()` sem argumento e `Date.now()` leem o
    // "agora" (proibidos); `new Date(valor)`, `Date.parse(valor)` e os métodos de instância só
    // transformam um dado que já se tem (permitidos em qualquer lugar) — por isso
    // no-restricted-globals (que não distingue aridade) não serve para Date, e viramos
    // no-restricted-syntax com seletores que olham os argumentos de verdade.
    files: ['src/**/*.ts'],
    ignores: ['src/adaptadores/relogio/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'setTimeout', message: MENSAGEM_RELOGIO('setTimeout') },
        { name: 'setInterval', message: MENSAGEM_RELOGIO('setInterval') },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: MENSAGEM_RELOGIO('new Date() sem argumento'),
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: MENSAGEM_RELOGIO('Date.now()'),
        },
      ],
    },
  },
);
