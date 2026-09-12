import { describe, expect, it } from 'vitest';
import { formatStatusReport, type StatusView } from '../../../src/cli/format-status.js';

function view(overrides: Partial<StatusView> = {}): StatusView {
  return {
    endOfDayTime: null,
    discoveredSessionCount: 0,
    eligibleSessionCount: 0,
    daemonAndScheduleReport: 'Daemon: not running.\nEnd-of-day: not configured (manual only).',
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

  /**
   * S4-T13: `format-status.ts` no longer decides anything about the daemon — it embeds whatever
   * `cli/daemon-state.ts#describeDaemonState` already rendered, verbatim, never re-deriving or
   * summarizing it. The multi-line shape (liveness + schedule + health, S4-T13's own combined
   * block) is passed through unchanged.
   */
  it('embeds the pre-rendered daemon/schedule report verbatim, without altering it', () => {
    const daemonAndScheduleReport = [
      'Daemon: running (pid 4242, started 2026-09-05T10:00:00.000Z).',
      'End-of-day: closing in about 15 minute(s), at 19:30.',
      'Snoozed today: 30 minute(s) total.',
      'Daemon health: healthy — no failed cycles recorded.',
    ].join('\n');

    const report = formatStatusReport(view({ daemonAndScheduleReport }));

    expect(report).toContain(daemonAndScheduleReport);
  });

  it('never falls back to the retired "not implemented yet" placeholder (D-025, S4-T13)', () => {
    const report = formatStatusReport(view());

    expect(report).not.toContain('not implemented yet');
  });
});
