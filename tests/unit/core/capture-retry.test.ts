/**
 * `core/capture-retry.ts` (S4-T3, docs/QUESTOES.md Q-040 item 3). Pure — no I/O, no Storage
 * double needed.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY,
  recordCaptureAttempts,
  sessionsExhaustedToday,
} from '../../../src/core/capture-retry.js';
import { emptyDayState } from '../../../src/core/schedule.js';

const DAY = '2026-09-05';

describe('recordCaptureAttempts', () => {
  it('increments a fresh session from 0 to 1', () => {
    const state = recordCaptureAttempts(emptyDayState(DAY), ['session-a']);
    expect(state.captureAttemptsToday).toStrictEqual({ 'session-a': 1 });
  });

  it('increments an existing count instead of resetting it', () => {
    const once = recordCaptureAttempts(emptyDayState(DAY), ['session-a']);
    const twice = recordCaptureAttempts(once, ['session-a']);
    expect(twice.captureAttemptsToday).toStrictEqual({ 'session-a': 2 });
  });

  it('tracks independent sessions independently', () => {
    const first = recordCaptureAttempts(emptyDayState(DAY), ['session-a']);
    const state = recordCaptureAttempts(first, ['session-b']);
    expect(state.captureAttemptsToday).toStrictEqual({ 'session-a': 1, 'session-b': 1 });
  });

  it('a single call can bump more than one session at once', () => {
    const state = recordCaptureAttempts(emptyDayState(DAY), ['session-a', 'session-b']);
    expect(state.captureAttemptsToday).toStrictEqual({ 'session-a': 1, 'session-b': 1 });
  });

  it('an empty list returns the SAME state object (no pointless copy)', () => {
    const state = emptyDayState(DAY);
    expect(recordCaptureAttempts(state, [])).toBe(state);
  });

  it('never touches any other DayState field', () => {
    const state = { ...emptyDayState(DAY), skipped: true, snoozeMinutesTotal: 30 };
    const updated = recordCaptureAttempts(state, ['session-a']);
    expect(updated.skipped).toBe(true);
    expect(updated.snoozeMinutesTotal).toBe(30);
  });
});

describe('sessionsExhaustedToday', () => {
  it('a fresh day has nothing exhausted', () => {
    expect(sessionsExhaustedToday(emptyDayState(DAY))).toStrictEqual(new Set());
  });

  it('a session below the limit is not exhausted', () => {
    const state = { ...emptyDayState(DAY), captureAttemptsToday: { 'session-a': 1 } };
    expect(sessionsExhaustedToday(state).has('session-a')).toBe(false);
  });

  it('a session exactly AT the limit is exhausted (boundary)', () => {
    const state = {
      ...emptyDayState(DAY),
      captureAttemptsToday: { 'session-a': MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY },
    };
    expect(sessionsExhaustedToday(state).has('session-a')).toBe(true);
  });

  it('a session one below the limit is NOT exhausted (boundary)', () => {
    const state = {
      ...emptyDayState(DAY),
      captureAttemptsToday: { 'session-a': MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY - 1 },
    };
    expect(sessionsExhaustedToday(state).has('session-a')).toBe(false);
  });

  it('only the sessions that hit the limit are reported, not every session tracked', () => {
    const state = {
      ...emptyDayState(DAY),
      captureAttemptsToday: {
        'session-a': MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY,
        'session-b': 1,
      },
    };
    expect(sessionsExhaustedToday(state)).toStrictEqual(new Set(['session-a']));
  });
});
