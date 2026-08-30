import { describe, expect, it } from 'vitest';
import { localDayString, subtractLocalDays } from '../../../src/core/day.js';

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

describe('subtractLocalDays', () => {
  it('goes back a single ordinary day', () => {
    const result = subtractLocalDays(new Date(2026, 7, 16, 21, 5, 0), 1);
    expect(localDayString(result)).toBe('2026-08-15');
  });

  it('offset 0 returns the same local day', () => {
    const result = subtractLocalDays(new Date(2026, 7, 16, 21, 5, 0), 0);
    expect(localDayString(result)).toBe('2026-08-16');
  });

  it('crosses a month boundary', () => {
    const result = subtractLocalDays(new Date(2026, 8, 1, 12, 0, 0), 1);
    expect(localDayString(result)).toBe('2026-08-31');
  });

  it('crosses a year boundary', () => {
    const result = subtractLocalDays(new Date(2026, 0, 1, 12, 0, 0), 1);
    expect(localDayString(result)).toBe('2025-12-31');
  });

  it('preserves the local time-of-day, only the calendar day moves', () => {
    const result = subtractLocalDays(new Date(2026, 7, 16, 21, 5, 30, 250), 3);
    expect(result.getHours()).toBe(21);
    expect(result.getMinutes()).toBe(5);
    expect(result.getSeconds()).toBe(30);
    expect(result.getMilliseconds()).toBe(250);
  });

  it('is composable: going back N days one at a time matches going back N at once', () => {
    const start = new Date(2026, 7, 16, 10, 0, 0);
    const stepwise = subtractLocalDays(subtractLocalDays(subtractLocalDays(start, 1), 1), 1);
    expect(localDayString(stepwise)).toBe(localDayString(subtractLocalDays(start, 3)));
  });
});
