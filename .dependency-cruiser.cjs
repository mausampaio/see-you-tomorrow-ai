/**
 * Regras de camada de docs/ARQUITETURA.md (tabela "De → Para", 5 camadas x 20 pares ordenados,
 * D-020), impostas por dependency-cruiser. Ver S0-T2 e S0-T6 em docs/PLANO-DE-ENTREGA.md.
 *
 * `cli/` é a única raiz de composição (D-020): só ele nomeia adapter concreto e injeta em
 * aplicacao/ e agendador/. Por isso aplicacao/ e agendador/ não podem importar adaptadores/
 * diretamente — só através das portas declaradas em nucleo/portas.ts. E agendador/ não pode
 * importar cli/: cli/ é quem constrói e injeta o agendador, nunca o contrário — importar cli/
 * a partir de agendador/ seria inversão de dependência da raiz de composição.
 *
 * Os caminhos de `from`/`to` são âncorados por segmento (`($|/)` depois do nome da camada): sem
 * isso, `^src/aplicacao` também casaria com um futuro `src/aplicacao-legado/`, que não é a
 * camada `aplicacao/` da matriz. Ver tests/integracao/guardas/dependency-cruiser.teste.ts para
 * o teste de regressão dessa âncora.
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
      from: { path: '^src/nucleo($|/)' },
      to: { path: '^src/(adaptadores|aplicacao|cli|agendador)($|/)' },
    },
    {
      name: 'nucleo-nao-importa-node',
      severity: 'error',
      comment:
        'nucleo/ não pode importar módulos nativos do Node (node:*). Isole o I/O num adaptador ' +
        'atrás de uma porta declarada em nucleo/portas.ts.',
      from: { path: '^src/nucleo($|/)' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'adaptadores-nao-importa-aplicacao-cli-ou-agendador',
      severity: 'error',
      comment:
        'adaptadores/ implementa portas do núcleo; não pode depender de aplicacao/, cli/ nem ' +
        'agendador/. Inverta a dependência: é aplicacao/ (ou agendador/) quem chama o adapter, ' +
        'nunca o contrário.',
      from: { path: '^src/adaptadores($|/)' },
      to: { path: '^src/(aplicacao|cli|agendador)($|/)' },
    },
    {
      name: 'aplicacao-nao-importa-adaptadores-cli-ou-agendador',
      severity: 'error',
      comment:
        'aplicacao/ define os casos de uso; cli/ e agendador/ são quem os chama (a seta aponta ' +
        'agendador → aplicacao em ARQUITETURA.md, nunca o contrário) — não pode ser o ' +
        'contrário. E aplicacao/ não pode importar adaptadores/ concreto (D-020): dependa só ' +
        'da porta declarada em nucleo/portas.ts; quem injeta a implementação é cli/, a única ' +
        'raiz de composição.',
      from: { path: '^src/aplicacao($|/)' },
      to: { path: '^src/(adaptadores|cli|agendador)($|/)' },
    },
    {
      name: 'agendador-nao-importa-adaptadores',
      severity: 'error',
      comment:
        'agendador/ recebe as dependências injetadas por cli/ (D-020, a única raiz de ' +
        'composição) — não pode nomear um adaptador concreto direto. Dependa da porta ' +
        'declarada em nucleo/portas.ts.',
      from: { path: '^src/agendador($|/)' },
      to: { path: '^src/adaptadores($|/)' },
    },
    {
      name: 'agendador-nao-importa-cli',
      severity: 'error',
      comment:
        'cli/ é a única raiz de composição (D-020): é ele que constrói o agendador e o injeta, ' +
        'nunca o contrário. agendador/ importar cli/ é inversão de dependência — se agendador/ ' +
        'precisa de algo de cli/, receba por parâmetro/construtor a partir de cli/.',
      from: { path: '^src/agendador($|/)' },
      to: { path: '^src/cli($|/)' },
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
