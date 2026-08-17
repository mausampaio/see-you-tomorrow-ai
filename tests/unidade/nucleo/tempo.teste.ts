import { describe, expect, it } from 'vitest';
import { mesmoInstante } from '../../../src/nucleo/tempo.js';

describe('mesmoInstante', () => {
  it('dois null contam como o mesmo instante (sem transcript nos dois lados, D-013)', () => {
    expect(mesmoInstante(null, null)).toBe(true);
  });

  it('null nunca é igual a um Date, mesmo um Date de época zero', () => {
    expect(mesmoInstante(null, new Date(0))).toBe(false);
    expect(mesmoInstante(new Date(0), null)).toBe(false);
  });

  it('duas instâncias de Date com o mesmo instante são iguais, mesmo objetos diferentes', () => {
    const a = new Date('2026-08-16T20:00:00.000Z');
    const b = new Date('2026-08-16T20:00:00.000Z');

    expect(a).not.toBe(b);
    expect(mesmoInstante(a, b)).toBe(true);
  });

  it('instantes diferentes por 1ms não são o mesmo instante', () => {
    const a = new Date('2026-08-16T20:00:00.000Z');
    const b = new Date('2026-08-16T20:00:00.001Z');

    expect(mesmoInstante(a, b)).toBe(false);
  });
});
