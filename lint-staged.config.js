/**
 * lint-staged config (pre-commit, see .husky/pre-commit and S0-T2 in
 * docs/PLANO-DE-ENTREGA.md). Separate `.js` file because type-checking can't be restricted to
 * the changed files — TypeScript needs the whole program to resolve types across modules — so
 * it's a function that ignores the file list and runs `tsc` on the whole project whenever any
 * `.ts` is in the commit.
 */
export default {
  '*.ts': ['eslint --fix'],
  '*.{ts,cts,mts}': () => 'tsc -p tsconfig.json --noEmit',
};
