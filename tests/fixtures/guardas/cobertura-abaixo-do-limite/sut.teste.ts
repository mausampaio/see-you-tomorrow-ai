import { describe, expect, it } from 'vitest';
import { escolher } from './sut.js';

/** Cobre só um dos dois ramos de propósito — é isso que o guard de cobertura deve reprovar. */
describe('sut', () => {
  it('escolhe "a" quando um é verdadeiro', () => {
    expect(escolher(true)).toBe('a');
  });
});
