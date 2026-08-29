import { describe, expect, it } from 'vitest';
import { formatSessionsReport } from '../../../src/cli/format-sessions.js';
import type { SessionRow } from '../../../src/cli/session-view.js';
import type { RejectedDiscoveryRecord } from '../../../src/core/ports.js';

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    name: 'projeto-01',
    cwd: 'c:\\code\\projeto-01',
    state: 'alive',
    lastActivity: new Date('2026-08-29T12:00:00.000Z'),
    canTerminate: false,
    ...overrides,
  };
}

describe('formatSessionsReport', () => {
  it('with zero sessions and zero rejections: a plain zero-sessions summary, no trailing sections', () => {
    const report = formatSessionsReport([], []);

    expect(report).toBe('0 sessions found.');
  });

  it('singular wording for exactly one session and one rejected entry', () => {
    const rejected: RejectedDiscoveryRecord[] = [
      {
        file: 'c:\\home\\.claude\\sessions\\broken.json',
        raw: 'not json',
        reason: 'not valid JSON',
      },
    ];

    const report = formatSessionsReport([row()], rejected);

    expect(report).toContain('1 session found, 1 entry ignored.');
  });

  it('plural wording for more than one of each', () => {
    const rejected: RejectedDiscoveryRecord[] = [
      { file: 'a.json', raw: undefined, reason: 'bad' },
      { file: 'b.json', raw: undefined, reason: 'bad' },
    ];

    const report = formatSessionsReport([row(), row({ name: 'projeto-02' })], rejected);

    expect(report).toContain('2 sessions found, 2 entries ignored.');
  });

  it('every session row shows name, cwd, state, last activity and the termination policy', () => {
    const report = formatSessionsReport(
      [row({ name: 'p', cwd: 'c:\\code\\p', state: 'idle', canTerminate: true })],
      [],
    );

    expect(report).toContain('- p (c:\\code\\p)');
    expect(report).toContain('state: idle');
    expect(report).toContain('last activity: 2026-08-29T12:00:00.000Z');
    expect(report).toContain('terminate on end-day: yes');
  });

  it('D-025: a null lastActivity renders as "unknown", never as "never" or an invented date', () => {
    const report = formatSessionsReport([row({ lastActivity: null })], []);

    expect(report).toContain('last activity: unknown');
    expect(report).not.toContain('never');
  });

  it('D-022/Q-012: rejections are listed with their file and reason, never silently dropped', () => {
    const rejected: RejectedDiscoveryRecord[] = [
      {
        file: 'c:\\home\\.claude\\sessions\\broken.json',
        raw: 'garbage',
        reason: 'not valid JSON: x',
      },
    ];

    const report = formatSessionsReport([], rejected);

    expect(report).toContain('Ignored entries:');
    expect(report).toContain('c:\\home\\.claude\\sessions\\broken.json: not valid JSON: x');
  });

  it('omits the "Ignored entries" section entirely when there is nothing to ignore', () => {
    const report = formatSessionsReport([row()], []);

    expect(report).not.toContain('Ignored entries');
  });
});
