/**
 * `scheduler/notices.ts` (S4-T3). Pure `Notice` construction — no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDaemonEndOfDayNotice,
  buildDaemonUnhealthyNotice,
  buildEarlyWarningsNotice,
  buildLeadTimeNotice,
  buildMissedEndOfDayNotice,
} from '../../../src/scheduler/notices.js';
import type { EarlyWarning } from '../../../src/core/early-warnings.js';
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

  // S4-T6, D-025: the number this function prints is the ACTUAL remaining time, not the configured
  // lead time that triggered the warning — the caller (`scheduler/poll.ts`) is what tells the two
  // apart now, this function just renders whatever it's handed. A regression here would be passing
  // the rule's own name back in, which this test can't distinguish from the honest case by itself —
  // `tests/unit/scheduler/poll.test.ts` is what proves the caller passes the REAL gap, not this
  // label-only rendering test.
  it('a value smaller than any configured lead time is reported as-is, not rounded up to one', () => {
    const notice = buildLeadTimeNotice(22, '2026-09-05');
    expect(notice.title).toContain('22 min');
    expect(notice.body).toContain('22 minutes');
  });

  it('singular "minute" at exactly 1 minute remaining (boundary)', () => {
    const notice = buildLeadTimeNotice(1, '2026-09-05');
    expect(notice.body).toContain('1 minute.');
    expect(notice.body).not.toContain('1 minutes');
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

describe('buildEarlyWarningsNotice (S4-T7 Part 2: one notice per poll cycle, not one per warning)', () => {
  const missingTranscript: EarlyWarning = {
    kind: 'missingTranscript',
    sessionId: 'session-a',
    message: 'Session "x" has no transcript.\nLikely cause: ...',
  };
  const uninspectable: EarlyWarning = {
    kind: 'uninspectableSession',
    keyFileName: '4242.abc.key',
    message: 'seeya found a session it cannot inspect: "4242.abc.key".\nNo matching record...',
  };

  it('a single warning: title says "1", body is just its first line', () => {
    const notice = buildEarlyWarningsNotice([missingTranscript]);
    expect(notice.title).toBe('seeya: 1 early warning');
    expect(notice.body).toContain('Session "x" has no transcript.');
    // Only the first line — never the multi-line explanation past it.
    expect(notice.body).not.toContain('Likely cause');
  });

  it('several warnings in the same cycle: title declares the count, body lists each one', () => {
    const notice = buildEarlyWarningsNotice([missingTranscript, uninspectable]);
    expect(notice.title).toBe('seeya: 2 early warnings');
    expect(notice.body).toContain('Session "x" has no transcript.');
    expect(notice.body).toContain('seeya found a session it cannot inspect: "4242.abc.key".');
  });

  it('never drops a warning silently: a burst past the shown cap still declares the true total and how many were left out', () => {
    const burst: EarlyWarning[] = Array.from({ length: 8 }, (_, i) => ({
      kind: 'missingTranscript',
      sessionId: `session-${i}`,
      message: `Session "s${i}" has no transcript.`,
    }));
    const notice = buildEarlyWarningsNotice(burst);
    expect(notice.title).toBe('seeya: 8 early warnings'); // the TRUE total, not just what's shown
    expect(notice.body).toContain('Session "s0" has no transcript.');
    expect(notice.body).toContain('Session "s4" has no transcript.'); // 5th shown item (index 4)
    expect(notice.body).not.toContain('Session "s5" has no transcript.'); // past the cap
    expect(notice.body).toContain('3 more warnings not shown'); // declared, never silently cut
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
