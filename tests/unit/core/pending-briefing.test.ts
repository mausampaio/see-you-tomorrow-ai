import { describe, expect, it } from 'vitest';
import {
  briefingStillPending,
  handoffStillPending,
  unresumedHandoffs,
} from '../../../src/core/pending-briefing.js';
import type { Briefing } from '../../../src/core/ports.js';
import { createHandoff } from './_fixtures.js';

describe('handoffStillPending — source: "model" (D-025: only a real verdict resolves)', () => {
  it('is pending when pendingItems is non-empty', () => {
    expect(handoffStillPending(createHandoff({ pendingItems: ['finish the parser'] }))).toBe(true);
  });

  it('is pending when tomorrowPlan is non-empty, even with no pendingItems', () => {
    expect(handoffStillPending(createHandoff({ tomorrowPlan: ['ship the release'] }))).toBe(true);
  });

  it('is NOT pending when the model explicitly reported nothing left', () => {
    expect(handoffStillPending(createHandoff({ pendingItems: [], tomorrowPlan: [] }))).toBe(false);
  });
});

describe('handoffStillPending — source !== "model" (D-025: absence of a verdict is not "done")', () => {
  it('a deterministic handoff counts as pending even with empty pendingItems/tomorrowPlan', () => {
    const handoff = createHandoff({
      source: 'deterministic',
      generationError: 'timeout',
      pendingItems: [],
      tomorrowPlan: [],
    });
    expect(handoffStillPending(handoff)).toBe(true);
  });

  it('a noTranscript handoff counts as pending even with empty pendingItems/tomorrowPlan', () => {
    const handoff = createHandoff({
      source: 'noTranscript',
      pendingItems: [],
      tomorrowPlan: [],
    });
    expect(handoffStillPending(handoff)).toBe(true);
  });
});

function briefingOf(handoffs: Briefing['handoffs']): Briefing {
  return { day: '2026-08-16', handoffs, rejected: [] };
}

describe('briefingStillPending', () => {
  it('is false for a briefing with no handoffs at all', () => {
    expect(briefingStillPending(briefingOf([]))).toBe(false);
  });

  it('is false when every handoff is a resolved, model-confirmed "nothing pending"', () => {
    const clean = createHandoff({ pendingItems: [], tomorrowPlan: [] });
    expect(briefingStillPending(briefingOf([clean]))).toBe(false);
  });

  it('is true when at least one handoff is pending, even if others are resolved', () => {
    const clean = createHandoff({
      sessionId: '11111111-1111-4111-8111-111111111111',
      pendingItems: [],
      tomorrowPlan: [],
    });
    const pending = createHandoff({
      sessionId: '22222222-2222-4222-8222-222222222222',
      pendingItems: ['write tests'],
    });
    expect(briefingStillPending(briefingOf([clean, pending]))).toBe(true);
  });

  it('is true when the only handoff never got a model verdict at all', () => {
    const deterministic = createHandoff({
      source: 'deterministic',
      generationError: 'network error',
      pendingItems: [],
      tomorrowPlan: [],
    });
    expect(briefingStillPending(briefingOf([deterministic]))).toBe(true);
  });
});

describe('handoffStillPending — resumed sessions (S3-T3): "não retomado E com conteúdo"', () => {
  it('a resumed session is never pending, even with real pendingItems still on the handoff', () => {
    const handoff = createHandoff({ pendingItems: ['still open on paper'] });
    expect(handoffStillPending(handoff, new Set([handoff.sessionId]))).toBe(false);
  });

  it('a resumed non-model handoff is also never pending — resumed wins over "no verdict"', () => {
    const handoff = createHandoff({ source: 'deterministic', generationError: 'timeout' });
    expect(handoffStillPending(handoff, new Set(['a-different-session']))).toBe(true);
    expect(handoffStillPending(handoff, new Set([handoff.sessionId]))).toBe(false);
  });

  it('marking a DIFFERENT session resumed does not affect this one', () => {
    const handoff = createHandoff({ pendingItems: ['still open'] });
    expect(handoffStillPending(handoff, new Set(['some-other-session-id']))).toBe(true);
  });

  it('defaults to an empty resumed set when none is passed (back-compat with existing call sites)', () => {
    expect(handoffStillPending(createHandoff({ pendingItems: ['x'] }))).toBe(true);
  });
});

describe('briefingStillPending — a day is pending until EVERY handoff is resumed (S3-T3, D-025 in reverse)', () => {
  it('one of two pending handoffs resumed: the briefing is STILL pending', () => {
    const resumed = createHandoff({
      sessionId: '11111111-1111-4111-8111-111111111111',
      pendingItems: ['done by hand already'],
    });
    const untouched = createHandoff({
      sessionId: '22222222-2222-4222-8222-222222222222',
      pendingItems: ['nobody looked at this'],
    });
    const stillPending = briefingStillPending(
      briefingOf([resumed, untouched]),
      new Set([resumed.sessionId]),
    );
    expect(stillPending).toBe(true);
  });

  it('both pending handoffs resumed: the briefing is no longer pending', () => {
    const a = createHandoff({ sessionId: '11111111-1111-4111-8111-111111111111' });
    const b = createHandoff({
      sessionId: '22222222-2222-4222-8222-222222222222',
      pendingItems: ['also resumed'],
    });
    const stillPending = briefingStillPending(
      briefingOf([a, b]),
      new Set([a.sessionId, b.sessionId]),
    );
    expect(stillPending).toBe(false);
  });
});

describe('unresumedHandoffs — the candidate set for step 3, a DIFFERENT filter than "pending"', () => {
  it('excludes a resumed handoff, keeps every other one', () => {
    const resumed = createHandoff({ sessionId: '11111111-1111-4111-8111-111111111111' });
    const other = createHandoff({ sessionId: '22222222-2222-4222-8222-222222222222' });
    const result = unresumedHandoffs(briefingOf([resumed, other]), new Set([resumed.sessionId]));
    expect(result).toEqual([other]);
  });

  it('keeps a model-confirmed-clean handoff that has not been resumed yet — it is a real, unactioned choice', () => {
    const clean = createHandoff({ pendingItems: [], tomorrowPlan: [] });
    const result = unresumedHandoffs(briefingOf([clean]), new Set());
    expect(result).toEqual([clean]);
  });

  it('an empty resumed set keeps every handoff', () => {
    const a = createHandoff({ sessionId: '11111111-1111-4111-8111-111111111111' });
    const b = createHandoff({ sessionId: '22222222-2222-4222-8222-222222222222' });
    expect(unresumedHandoffs(briefingOf([a, b]), new Set())).toEqual([a, b]);
  });
});
