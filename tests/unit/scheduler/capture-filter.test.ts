/**
 * `scheduler/capture-filter.ts` (S4-T3). Pure — no I/O.
 */
import { describe, expect, it } from 'vitest';
import { buildRetryFilter, nonModelSessionIds } from '../../../src/scheduler/capture-filter.js';
import { emptyDayState } from '../../../src/core/schedule.js';
import { MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY } from '../../../src/core/capture-retry.js';
import { createSessionWithPid } from '../core/_fixtures.js';
import type { EndDayResult } from '../../../src/application/types.js';

const DAY = '2026-09-05';

function emptyEndDayResult(overrides: Partial<EndDayResult> = {}): EndDayResult {
  return {
    day: DAY,
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

describe('buildRetryFilter', () => {
  it('returns undefined (no filter) when nothing is exhausted yet', () => {
    expect(buildRetryFilter(emptyDayState(DAY))).toBeUndefined();
  });

  it('excludes an exhausted session and keeps every other one', () => {
    const state = {
      ...emptyDayState(DAY),
      captureAttemptsToday: { 'exhausted-session': MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY },
    };
    const filter = buildRetryFilter(state);
    expect(filter).toBeDefined();
    const exhausted = createSessionWithPid({ sessionId: 'exhausted-session' });
    const fresh = createSessionWithPid({ sessionId: 'fresh-session' });
    expect(filter?.(exhausted)).toBe(false);
    expect(filter?.(fresh)).toBe(true);
  });
});

describe('nonModelSessionIds', () => {
  it('empty result: nothing to record', () => {
    expect(nonModelSessionIds(emptyEndDayResult())).toStrictEqual([]);
  });

  it('a failed capture counts', () => {
    const result = emptyEndDayResult({
      failedCaptures: [{ sessionId: 'a', cwd: 'c:\\x', name: 'x', reason: 'boom' }],
    });
    expect(nonModelSessionIds(result)).toStrictEqual(['a']);
  });

  it('a captured handoff with source "deterministic" counts', () => {
    const result = emptyEndDayResult({
      captured: [
        { handoff: { sessionId: 'b', source: 'deterministic' } as never, terminated: false },
      ],
    });
    expect(nonModelSessionIds(result)).toStrictEqual(['b']);
  });

  it('a captured handoff with source "noTranscript" counts, same as "deterministic" (Q-040 item 2)', () => {
    const result = emptyEndDayResult({
      captured: [
        { handoff: { sessionId: 'c', source: 'noTranscript' } as never, terminated: false },
      ],
    });
    expect(nonModelSessionIds(result)).toStrictEqual(['c']);
  });

  it('a captured handoff with source "model" does NOT count — real progress, not a wasted attempt', () => {
    const result = emptyEndDayResult({
      captured: [{ handoff: { sessionId: 'd', source: 'model' } as never, terminated: false }],
    });
    expect(nonModelSessionIds(result)).toStrictEqual([]);
  });

  it('an ineligible session does not count — endDay never attempted generation for it', () => {
    const result = emptyEndDayResult({
      ineligible: [{ sessionId: 'e', cwd: 'c:\\x', name: 'x', reasons: ['duplicateToday'] }],
    });
    expect(nonModelSessionIds(result)).toStrictEqual([]);
  });

  it('mixes failed and non-model captured sessions together', () => {
    const result = emptyEndDayResult({
      failedCaptures: [{ sessionId: 'a', cwd: 'c:\\x', name: 'x', reason: 'boom' }],
      captured: [
        { handoff: { sessionId: 'b', source: 'deterministic' } as never, terminated: false },
      ],
    });
    expect(nonModelSessionIds(result)).toStrictEqual(['a', 'b']);
  });
});
