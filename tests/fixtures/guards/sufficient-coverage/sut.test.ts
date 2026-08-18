import { describe, expect, it } from 'vitest';
import { choose } from './sut.js';

/** Covers both branches — the coverage guard should approve. */
describe('sut', () => {
  it('chooses "a" when one is true', () => {
    expect(choose(true)).toBe('a');
  });

  it('chooses "b" when one is false', () => {
    expect(choose(false)).toBe('b');
  });
});
