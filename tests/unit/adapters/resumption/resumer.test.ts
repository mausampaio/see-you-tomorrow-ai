import { describe, expect, it } from 'vitest';
import { resolveClaudeBinary } from '../../../../src/adapters/resumption/resumer.js';

/** Pure-function unit test for the one branch `tests/integration/resumption/resumer.test.ts`
 * deliberately never exercises: actually spawning the literal string `'claude'` in a test would
 * invoke whatever real binary is on the machine's `PATH` (forbidden — CLAUDE.md/
 * docs/PLANO-DE-ENTREGA.md: no test in this suite calls the real API). */
describe('resolveClaudeBinary', () => {
  it('defaults to the literal "claude" when no override is given', () => {
    expect(resolveClaudeBinary({})).toBe('claude');
  });

  it('uses the override when one is given (test fixtures rely on this)', () => {
    expect(resolveClaudeBinary({ claudeBinary: '/path/to/fake-claude' })).toBe(
      '/path/to/fake-claude',
    );
  });
});
