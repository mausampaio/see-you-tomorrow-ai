/**
 * `scheduler/notices.ts` (S4-T3). Pure `Notice` construction — no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDaemonEndOfDayNotice,
  buildEarlyWarningNotice,
  buildLeadTimeNotice,
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
  it('an on-time close (delayMs well under the threshold) is not marked delayed', () => {
    const notice = buildDaemonEndOfDayNotice(emptyEndDayResult(), 5_000, '2026-09-05');
    expect(notice.title).not.toContain('delayed');
    expect(notice.body).not.toContain('asleep');
  });

  it('a delay right at the threshold IS marked delayed (boundary)', () => {
    const notice = buildDaemonEndOfDayNotice(emptyEndDayResult(), 5 * 60_000, '2026-09-05');
    expect(notice.title).toContain('delayed');
    expect(notice.body).toContain('asleep');
  });

  it('a delay one millisecond under the threshold is NOT marked delayed (boundary)', () => {
    const notice = buildDaemonEndOfDayNotice(emptyEndDayResult(), 5 * 60_000 - 1, '2026-09-05');
    expect(notice.title).not.toContain('delayed');
  });

  it('reports how many sessions were captured', () => {
    const result = emptyEndDayResult({
      captured: [
        { handoff: { sessionId: 'a' } as never, terminated: false },
        { handoff: { sessionId: 'b' } as never, terminated: false },
      ],
    });
    const notice = buildDaemonEndOfDayNotice(result, 0, '2026-09-05');
    expect(notice.body).toContain('2 sessions captured');
  });

  it('names a failed capture count when there is one', () => {
    const result = emptyEndDayResult({
      failedCaptures: [{ sessionId: 'a', cwd: 'c:\\x', name: 'x', reason: 'boom' }],
    });
    const notice = buildDaemonEndOfDayNotice(result, 0, '2026-09-05');
    expect(notice.body).toContain('1 capture failed');
  });

  it('says nothing about failures when there are none', () => {
    const notice = buildDaemonEndOfDayNotice(emptyEndDayResult(), 0, '2026-09-05');
    expect(notice.body).not.toContain('failed');
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
