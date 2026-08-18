import { describe, expect, it } from 'vitest';
import { choose } from './sut.js';

/** Covers only one of the two branches on purpose — this is what the coverage guard should reject. */
describe('sut', () => {
  it('chooses "a" when one is true', () => {
    expect(choose(true)).toBe('a');
  });
});
