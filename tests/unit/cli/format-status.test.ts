import { describe, expect, it } from 'vitest';
import { formatStatusReport, type StatusView } from '../../../src/cli/format-status.js';

function view(overrides: Partial<StatusView> = {}): StatusView {
  return {
    endOfDayTime: null,
    discoveredSessionCount: 0,
    eligibleSessionCount: 0,
    ...overrides,
  };
}

describe('formatStatusReport', () => {
  it('shows "not configured (manual only)" when endOfDayTime is null (Q-013 default)', () => {
    const report = formatStatusReport(view({ endOfDayTime: null }));

    expect(report).toContain('End-of-day time: not configured (manual only)');
  });

  it('shows the configured local time as-is, never converted to an instant (docs/ARQUITETURA.md § "Fusos e horários")', () => {
    const report = formatStatusReport(view({ endOfDayTime: '19:30' }));

    expect(report).toContain('End-of-day time: 19:30 local');
  });

  it('shows the eligible/discovered session counts', () => {
    const report = formatStatusReport(view({ eligibleSessionCount: 2, discoveredSessionCount: 5 }));

    expect(report).toContain('Eligible sessions: 2 of 5 discovered');
  });

  it('declares the daemon as not implemented yet, rather than inventing a running/stopped state', () => {
    const report = formatStatusReport(view());

    expect(report).toContain('Daemon: not implemented yet');
  });
});
