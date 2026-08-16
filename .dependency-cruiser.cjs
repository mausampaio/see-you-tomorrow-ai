/**
 * Regras de camada de docs/ARQUITETURA.md, impostas por dependency-cruiser. Ver S0-T2 em
 * docs/PLANO-DE-ENTREGA.md.
 *
 * Arquivo em CommonJS (`.cjs`) de propósito: o pacote é `"type": "module"`, e o carregador de
 * config do dependency-cruiser é mais previsível com `module.exports` do que com um `.js` ESM.
 */
module.exports = {
  forbidden: [
    {
      name: 'nucleo-nao-importa-outras-camadas',
      severity: 'error',
      comment:
        'nucleo/ é puro: não pode importar adaptadores/, aplicacao/, cli/ nem agendador/. ' +
        'Declare uma porta em nucleo/portas.ts e implemente-a num adaptador.',
      from: { path: '^src/nucleo' },
      to: { path: '^src/(adaptadores|aplicacao|cli|agendador)' },
    },
    {
      name: 'nucleo-nao-importa-node',
      severity: 'error',
      comment:
        'nucleo/ não pode importar módulos nativos do Node (node:*). Isole o I/O num adaptador ' +
        'atrás de uma porta declarada em nucleo/portas.ts.',
      from: { path: '^src/nucleo' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'adaptadores-nao-importa-aplicacao-ou-cli',
      severity: 'error',
      comment:
        'adaptadores/ implementa portas do núcleo; não pode depender de aplicacao/ nem de ' +
        'cli/. Inverta a dependência: é aplicacao/ quem chama o adapter, nunca o contrário.',
      from: { path: '^src/adaptadores' },
      to: { path: '^src/(aplicacao|cli)' },
    },
    {
      name: 'aplicacao-nao-importa-cli',
      severity: 'error',
      comment:
        'aplicacao/ define os casos de uso; cli/ é quem os chama. Não pode ser o contrário — ' +
        'mova o que cli/ precisa para dentro do caso de uso.',
      from: { path: '^src/aplicacao' },
      to: { path: '^src/cli' },
    },
    {
      name: 'sem-dependencia-circular',
      severity: 'error',
      comment:
        'Ciclo de dependência entre módulos do projeto. Quebre o ciclo extraindo a parte comum ' +
        'para outro módulo ou invertendo uma das pontas pela porta certa.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    // Resolve o suficiente para saber que um pacote é 'npm'/'core', mas não entra nos módulos
    // internos de node_modules — senão um ciclo interno de uma dependência (ex.: zod) dispara a
    // regra sem-dependencia-circular, que é para o nosso código, não para o de terceiros.
    doNotFollow: {
      path: 'node_modules',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
  },
};
