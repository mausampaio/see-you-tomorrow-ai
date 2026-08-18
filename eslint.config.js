// ESLint config (flat config). See docs/PLANO-DE-ENTREGA.md S0-T2: type-aware rules
// (recommendedTypeChecked) plus the two boundary guards dependency-cruiser doesn't cover on its
// own — banning node:* in core/ and, outside adapters/clock/, non-deterministic time sources
// (D-019: argument-less `new Date()`, `Date.now()`, setTimeout/setInterval). `new Date(valor)`
// and `Date.parse` stay free anywhere — they aren't a read of "now", they're a deterministic
// transformation of data already in hand.
import tseslint from 'typescript-eslint';

const NODE_IN_CORE_MESSAGE =
  'core/ is pure and cannot import Node modules (node:*). Isolate I/O in an adapter behind a ' +
  'port declared in core/ports.ts.';

const CLOCK_MESSAGE = (name) =>
  `${name} can only be used in src/adapters/clock/. Anywhere else, use the Clock port ` +
  '(core/ports.ts) to get the current instant or schedule something.';

export default tseslint.config(
  {
    // .dependency-cruiser.cjs is CommonJS on purpose (see the file itself) and isn't part of
    // the project's TypeScript program — it's out of the type-aware ESLint's scope.
    // coverage/** is '**/coverage/**' (not just the root one) because the fixtures in
    // tests/fixtures/guards/ generate their own when they run.
    // tests/fixtures/**/*.mjs: plain Node scripts spawned as real child processes by
    // integration tests (e.g. tests/fixtures/process/), never imported nor compiled — they
    // aren't part of the TypeScript program (tsconfig.json's "include" doesn't reach them) and
    // `allowDefaultProject` only covers the two root-level .js config files, not a whole
    // directory of them.
    ignores: [
      'dist/**',
      '**/coverage/**',
      'node_modules/**',
      '.dependency-cruiser.cjs',
      'tests/fixtures/**/*.mjs',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // allowJs is off (on purpose: we don't want stray .js in src/), so no .js at the root
        // actually enters the tsc program even though it's listed in tsconfig.json's "include".
        // The project's two .js config files enter here.
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'lint-staged.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // node:* is forbidden only in the core — in any other directory it's normal and necessary.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: NODE_IN_CORE_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // The non-deterministic time source only exists in adapters/clock/, which implements the
    // Clock port (D-019). setTimeout/setInterval are banned outright — they have no
    // deterministic form. Date is finer-grained: argument-less `new Date()` and `Date.now()`
    // read "now" (forbidden); `new Date(valor)`, `Date.parse(valor)` and instance methods only
    // transform data already in hand (allowed anywhere) — that's why no-restricted-globals
    // (which doesn't distinguish arity) doesn't work for Date, and we turn to
    // no-restricted-syntax with selectors that actually look at the arguments.
    files: ['src/**/*.ts'],
    ignores: ['src/adapters/clock/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'setTimeout', message: CLOCK_MESSAGE('setTimeout') },
        { name: 'setInterval', message: CLOCK_MESSAGE('setInterval') },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: CLOCK_MESSAGE('argument-less new Date()'),
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: CLOCK_MESSAGE('Date.now()'),
        },
      ],
    },
  },
);
