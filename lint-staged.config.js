/**
 * Config do lint-staged (pre-commit, ver .husky/pre-commit e S0-T2 em
 * docs/PLANO-DE-ENTREGA.md). Arquivo `.js` separado porque a checagem de tipos não pode ser
 * restrita aos arquivos alterados — o TypeScript precisa do programa inteiro para resolver tipos
 * entre módulos — então ela é uma função que ignora a lista de arquivos e roda `tsc` no projeto
 * todo sempre que algum `.ts` estiver no commit.
 */
export default {
  '*.ts': ['eslint --fix'],
  '*.{ts,cts,mts}': () => 'tsc -p tsconfig.json --noEmit',
};
