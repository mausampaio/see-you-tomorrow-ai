import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Proves @types/node is installed (S0-T2): outside core/, node:* is normal, and this file only
 * compiles (tsc and the type-aware eslint) because node:fs's types are available. Without
 * @types/node, `import ... from 'node:fs'` fails at type-checking time (TS2307) — the file
 * wouldn't even get to run.
 *
 * On purpose, doesn't call `existsSync` for real (no unit test touches disk, see
 * docs/TESTES.md) — it just references the imported symbol, which is already enough to require
 * the types.
 */
describe('probe: node types', () => {
  it('resolves the type of node:fs#existsSync', () => {
    expect(typeof existsSync).toBe('function');
  });
});
