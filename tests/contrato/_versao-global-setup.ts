/**
 * Global setup for the `contrato` project (see `vitest.config.ts`). Runs **exactly once**,
 * before any test, in vitest's main process — that's why the `console.log` here appears straight
 * on `npm run test:contrato`'s stdout with **any** reporter, including the default one.
 *
 * This exists because the review measured the defect: embedding the version only in each
 * `describe`'s name (`tests/contrato/_apoio.ts`) isn't visible on the happy path — vitest's
 * default reporter only prints test names on failure or with `--reporter=verbose`.
 * docs/TESTES.md requires logging the version on **every run**, not only when something breaks
 * or when someone remembers the right flag.
 */
import { getClaudeCodeVersion } from './_apoio.js';

export default function setup(): void {
  const version = getClaudeCodeVersion();
  // The only console.* in this project outside adapters/clock or a logger: it's mandatory
  // contract-suite diagnostics (docs/TESTES.md), not product logging — CLAUDE.md § Qualidade
  // talks about stray `console.log` in product code, not a test setup that exists specifically
  // to write this.
  console.log(`\n[contrato] running against claude ${version}\n`);
}
