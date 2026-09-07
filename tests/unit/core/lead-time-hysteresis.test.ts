/**
 * `core/lead-time-hysteresis.ts` (S4-T7 Part 1). Pure, no I/O — every case is a plain `Date`
 * comparison, cheap enough to pin every boundary explicitly (AGENTS.md: "100% de linhas não é
 * 100% de comportamento").
 */
import { describe, expect, it } from 'vitest';
import { shouldSuppressLeadTimeWarning } from '../../../src/core/lead-time-hysteresis.js';

const NOW = new Date('2026-09-05T19:20:00.000Z');

describe('shouldSuppressLeadTimeWarning', () => {
  // D-025, S4-T7's own acceptance: "o primeiro aviso do dia nunca é engolido".
  it('never suppresses when nothing has fired yet today (lastFiredAt: null)', () => {
    expect(shouldSuppressLeadTimeWarning(null, NOW, 3)).toBe(false);
  });

  it('suppresses when the previous notice fired well inside the gap', () => {
    const lastFiredAt = new Date(NOW.getTime() - 30_000); // 30s ago — the measured S4-T6 bug case
    expect(shouldSuppressLeadTimeWarning(lastFiredAt, NOW, 3)).toBe(true);
  });

  it('does not suppress once the gap has fully elapsed', () => {
    const lastFiredAt = new Date(NOW.getTime() - 5 * 60_000); // 5 minutes ago
    expect(shouldSuppressLeadTimeWarning(lastFiredAt, NOW, 3)).toBe(false);
  });

  // The config's own docstring calls it a MINIMUM gap — exactly N minutes already satisfies it.
  it('boundary: a gap of EXACTLY minGapMinutes is NOT suppressed', () => {
    const lastFiredAt = new Date(NOW.getTime() - 3 * 60_000);
    expect(shouldSuppressLeadTimeWarning(lastFiredAt, NOW, 3)).toBe(false);
  });

  it('boundary: one second short of minGapMinutes IS suppressed', () => {
    const lastFiredAt = new Date(NOW.getTime() - (3 * 60_000 - 1000));
    expect(shouldSuppressLeadTimeWarning(lastFiredAt, NOW, 3)).toBe(true);
  });

  // 0 is a meaningful config value (adapters/storage/config-schema.ts's own docstring): "never
  // suppress a second notice, no matter how close together".
  it('minGapMinutes: 0 never suppresses, even a millisecond after the previous notice', () => {
    const lastFiredAt = new Date(NOW.getTime() - 1);
    expect(shouldSuppressLeadTimeWarning(lastFiredAt, NOW, 0)).toBe(false);
  });
});
