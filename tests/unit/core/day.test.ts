import { describe, expect, it } from 'vitest';
import { localDayString } from '../../../src/core/day.js';

describe('localDayString', () => {
  it('formats year, month and day, zero-padded', () => {
    expect(localDayString(new Date(2026, 0, 5, 10, 0, 0))).toBe('2026-01-05');
  });

  it('pads single-digit month and day', () => {
    expect(localDayString(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('does not pad a two-digit month or day', () => {
    expect(localDayString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('uses local getters, not UTC — a local instant near midnight stays on its local day', () => {
    // Constructed from local components (no 'Z'), so this is unambiguous across the CI machine's
    // timezone: getFullYear/getMonth/getDate must read back exactly what was constructed.
    const localMidnight = new Date(2026, 2, 1, 0, 0, 1);
    expect(localDayString(localMidnight)).toBe('2026-03-01');
  });
});
