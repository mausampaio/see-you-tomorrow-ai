/**
 * `localDayBounds`/`isWithinLocalDay` — the pure math behind "commits do dia"
 * (docs/PLANO-DE-ENTREGA.md S2-T1). The whole point of these tests is the case the task that
 * requested this adapter names explicitly: a commit made late at night, local time, must not
 * count as "yesterday" just because its UTC instant already rolled over — and the reverse, a
 * commit just after local midnight must not leak into "yesterday" either.
 */
import { describe, expect, it } from 'vitest';
import { isWithinLocalDay, localDayBounds } from '../../../../src/adapters/git/local-day.js';

describe('localDayBounds', () => {
  it('start of today is local midnight, and start of tomorrow is 24h later', () => {
    const now = new Date(2026, 7, 16, 14, 30, 0); // 2026-08-16 14:30 local
    const bounds = localDayBounds(now);

    expect(bounds.startOfToday).toStrictEqual(new Date(2026, 7, 16, 0, 0, 0, 0));
    expect(bounds.startOfTomorrow).toStrictEqual(new Date(2026, 7, 17, 0, 0, 0, 0));
  });

  it('rolls over month and year correctly (Dec 31 -> Jan 1)', () => {
    const now = new Date(2026, 11, 31, 23, 59, 0);
    const bounds = localDayBounds(now);

    expect(bounds.startOfTomorrow).toStrictEqual(new Date(2027, 0, 1, 0, 0, 0, 0));
  });
});

describe('isWithinLocalDay', () => {
  const now = new Date(2026, 7, 16, 12, 0, 0);
  const bounds = localDayBounds(now);

  it('a commit at local midnight is within today (inclusive lower bound)', () => {
    expect(isWithinLocalDay(new Date(2026, 7, 16, 0, 0, 0, 0), bounds)).toBe(true);
  });

  it('a commit one millisecond before local midnight is yesterday, not today', () => {
    expect(isWithinLocalDay(new Date(2026, 7, 15, 23, 59, 59, 999), bounds)).toBe(false);
  });

  it('a commit at 23:59:59.999 local today is still today (exclusive upper bound)', () => {
    expect(isWithinLocalDay(new Date(2026, 7, 16, 23, 59, 59, 999), bounds)).toBe(true);
  });

  it('the instant local midnight of tomorrow is tomorrow, not today', () => {
    expect(isWithinLocalDay(new Date(2026, 7, 17, 0, 0, 0, 0), bounds)).toBe(false);
  });
});
