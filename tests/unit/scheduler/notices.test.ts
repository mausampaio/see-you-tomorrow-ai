/**
 * `scheduler/notices.ts` (S4-T3). Pure `Notice` construction — no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDaemonEndOfDayNotice,
  buildDaemonUnhealthyNotice,
  buildEarlyWarningNotice,
  buildLeadTimeNotice,
  buildMissedEndOfDayNotice,
} from '../../../src/scheduler/notices.js';
import type { EndDayResult } from '../../../src/application/types.js';

function emptyEndDayResult(overrides: Partial<EndDayResult> = {}): EndDayResult {
  return {
    day: '2026-09-05',
    scope: { kind: 'fullDay' },
    discoveredCount: 0,
    rejectedDiscoveries: [],
    ineligible: [],
    captured: [],
    failedCaptures: [],
    terminationNotices: [],
    dryRun: false,
    briefingPreview: null,
    sessionsInScope: 0,
    listedSessions: [],
    forkCleanup: null,
    forkCleanupError: null,
    ...overrides,
  };
}

describe('buildLeadTimeNotice', () => {
  it('names the minutes and the day, and the commands to react', () => {
    const notice = buildLeadTimeNotice(30, '2026-09-05');
    expect(notice.title).toContain('30 min');
    expect(notice.body).toContain('2026-09-05');
    expect(notice.body).toContain('seeya snooze');
    expect(notice.body).toContain('seeya skip-today');
  });
});

describe('buildDaemonEndOfDayNotice', () => {
  // D-036/D-035: the threshold comparison itself now lives in `scheduler/poll.ts` (it reads
  // `Config.overdueFireThresholdMinutes`), not here — this function only renders whatever `overdue`
  // boolean the caller already decided. `tests/unit/scheduler/poll.test.ts` covers the threshold
  // boundary; this file only covers rendering.
  it('overdue: false is not marked delayed and says nothing about termination', () => {
    const notice = buildDaemonEndOfDayNotice(emptyEndDayResult(), 5_000, '2026-09-05', false);
    expect(notice.title).not.toContain('delayed');
    expect(notice.body).not.toContain('terminated');
  });

  it('overdue: true is marked delayed and says termination was skipped (D-036)', () => {
    const notice = buildDaemonEndOfDayNotice(emptyEndDayResult(), 5 * 60_000, '2026-09-05', true);
    expect(notice.title).toContain('delayed');
    expect(notice.body).toContain('no session was terminated');
    expect(notice.body).toContain('canTerminate');
  });

  it('singular "minute" at exactly 1 minute late (boundary)', () => {
    const notice = buildDaemonEndOfDayNotice(emptyEndDayResult(), 60_000, '2026-09-05', true);
    expect(notice.body).toContain('1 minute late');
    expect(notice.body).not.toContain('1 minutes late');
  });

  it('reports how many sessions were captured', () => {
    const result = emptyEndDayResult({
      captured: [
        { handoff: { sessionId: 'a' } as never, terminated: false },
        { handoff: { sessionId: 'b' } as never, terminated: false },
      ],
    });
    const notice = buildDaemonEndOfDayNotice(result, 0, '2026-09-05', false);
    expect(notice.body).toContain('2 sessions captured');
  });

  it('names a failed capture count when there is one', () => {
    const result = emptyEndDayResult({
      failedCaptures: [{ sessionId: 'a', cwd: 'c:\\x', name: 'x', reason: 'boom' }],
    });
    const notice = buildDaemonEndOfDayNotice(result, 0, '2026-09-05', false);
    expect(notice.body).toContain('1 capture failed');
  });

  it('says nothing about failures when there are none', () => {
    const notice = buildDaemonEndOfDayNotice(emptyEndDayResult(), 0, '2026-09-05', false);
    expect(notice.body).not.toContain('failed');
  });
});

describe('buildMissedEndOfDayNotice (D-036, "dia local diferente")', () => {
  it('names the missed day and says nothing was captured or terminated', () => {
    const notice = buildMissedEndOfDayNotice('2026-09-04');
    expect(notice.title).toContain('2026-09-04');
    expect(notice.body).toContain('2026-09-04');
    expect(notice.body).toContain('Nothing was captured or terminated');
  });

  it('points at "seeya sessions" and "seeya end-day" as the honest recovery, not a promise to redo the missed day', () => {
    const notice = buildMissedEndOfDayNotice('2026-09-04');
    expect(notice.body).toContain('seeya sessions');
    expect(notice.body).toContain('seeya end-day');
    expect(notice.body).toContain('no way to redo it');
  });
});

describe('buildEarlyWarningNotice', () => {
  it('missingTranscript gets its own title and passes the message through unchanged', () => {
    const notice = buildEarlyWarningNotice({
      kind: 'missingTranscript',
      sessionId: 'session-a',
      message: 'Session "x" has no transcript.',
    });
    expect(notice.title).toContain('no transcript');
    expect(notice.body).toBe('Session "x" has no transcript.');
  });

  it('uninspectableSession gets a different title', () => {
    const notice = buildEarlyWarningNotice({
      kind: 'uninspectableSession',
      keyFileName: '4242.abc.key',
      message: 'seeya found a session it cannot inspect: "4242.abc.key".',
    });
    expect(notice.title).toContain('uninspectable');
    expect(notice.body).toContain('4242.abc.key');
  });
});

describe('buildDaemonUnhealthyNotice', () => {
  it('reports elapsed minutes computed from the failure count, and the last error message', () => {
    const notice = buildDaemonUnhealthyNotice({
      lastCycleError: { message: 'ECONNREFUSED', at: new Date('2026-09-05T10:00:00.000Z') },
      consecutiveCycleFailures: 120, // 120 * 30s = 3600s = 60 minutes
    });
    expect(notice.title).toBe('seeya: daemon is stuck');
    expect(notice.body).toContain('60 minutes');
    expect(notice.body).toContain('ECONNREFUSED');
  });

  it('singular "minute" at exactly 2 consecutive failures (60s, boundary)', () => {
    const notice = buildDaemonUnhealthyNotice({
      lastCycleError: { message: 'x', at: new Date('2026-09-05T10:00:00.000Z') },
      consecutiveCycleFailures: 2, // 2 * 30s = 60s = 1 minute
    });
    expect(notice.body).toContain('1 minute ');
    expect(notice.body).not.toContain('1 minutes');
  });

  it('falls back to "unknown error" when there is no recorded lastCycleError (defensive — not reachable via recordCycleFailure today)', () => {
    const notice = buildDaemonUnhealthyNotice({
      lastCycleError: null,
      consecutiveCycleFailures: 120,
    });
    expect(notice.body).toContain('unknown error');
  });
});
