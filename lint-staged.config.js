/**
 * lint-staged config (pre-commit, see .husky/pre-commit and S0-T2 in
 * docs/PLANO-DE-ENTREGA.md). Separate `.js` file because type-checking can't be restricted to
 * the changed files — TypeScript needs the whole program to resolve types across modules — so
 * it's a function that ignores the file list and runs `tsc` on the whole project whenever any
 * `.ts` is in the commit.
 *
 * `prettier --write` runs on every staged file prettier covers (S1-T0f): it respects
 * .prettierignore on its own, so dist/, coverage/, docs/ and AGENTS.md are skipped without
 * listing them here. This is the auto-fix half of formatting enforcement — it never fails the
 * commit, it just rewrites the file before eslint/tsc see it. `format:check` in `verificar` is
 * the half that actually fails the build, for anything that reaches a commit without going
 * through lint-staged (e.g. `--no-verify`).
 */
export default {
  '*.{ts,cts,mts,js,cjs,mjs,json,yml,yaml,md}': ['prettier --write'],
  '*.ts': ['eslint --fix'],
  '*.{ts,cts,mts}': () => 'tsc -p tsconfig.json --noEmit',
};
