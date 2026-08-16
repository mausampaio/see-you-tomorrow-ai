import { describe, expect, it } from 'vitest';
import { escolher } from './sut.js';

/** Cobre os dois ramos — o guard de cobertura deve aprovar. */
describe('sut', () => {
  it('escolhe "a" quando um é verdadeiro', () => {
    expect(escolher(true)).toBe('a');
  });

  it('escolhe "b" quando um é falso', () => {
    expect(escolher(false)).toBe('b');
  });
});
