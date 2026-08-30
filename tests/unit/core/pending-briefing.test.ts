import { describe, expect, it } from 'vitest';
import { briefingStillPending, handoffStillPending } from '../../../src/core/pending-briefing.js';
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
