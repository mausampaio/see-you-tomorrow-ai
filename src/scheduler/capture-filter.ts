/**
 * The daemon-only half of S4-T3's capture retry budget (`core/capture-retry.ts` has the pure
 * counting/exhaustion rules over `DayState.captureAttemptsToday`; this file is what connects that
 * to `application/endDay`'s own `EndDayOptions.sessionFilter`/`EndDayResult`).
 */
import type { DiscoveredSession } from '../core/types.js';
import type { EndDayOptions, EndDayResult } from '../application/types.js';
import { sessionsExhaustedToday } from '../core/capture-retry.js';
import type { DayState } from '../core/types.js';

/**
 * Excludes any `sessionId` that already used up today's retry budget
 * (`core/capture-retry.ts#sessionsExhaustedToday`) from `endDay`'s own capture pass — built fresh
 * from the LATEST `DayState` before every `endDay()` call the daemon makes for an `endOfDay`
 * decision, so a session that becomes exhausted mid-retry-window stops being re-attempted on the
 * very next poll. `undefined` (no filter at all) when nothing is exhausted yet — `endDay` already
 * treats a missing `sessionFilter` as "every discovered session", so there's no reason to hand it
 * an always-true predicate instead.
 */
export function buildRetryFilter(state: DayState): EndDayOptions['sessionFilter'] {
  const exhausted = sessionsExhaustedToday(state);
  if (exhausted.size === 0) {
    return undefined;
  }
  return (session: DiscoveredSession) => !exhausted.has(session.sessionId);
}

/**
 * Every `sessionId` from this `endDay()` call that should count against today's retry budget
 * (`core/types.ts#DayState.captureAttemptsToday`'s own docstring has the full reasoning): a full
 * capture failure, or a captured handoff whose `source` ISN'T `model` — Q-040's same distinction
 * `core/eligibility.ts`'s anti-duplication condition already draws, applied here to a different
 * question ("should this count as a wasted attempt?") instead of ("is this a duplicate?").
 *
 * Deliberately excludes `ineligible` sessions — D-026's anti-duplication, `noEvidence`,
 * `noRecentActivity` etc. all mean `endDay` never even reached generation for that session this
 * round, so there was no attempt to count, wasted or otherwise.
 */
export function nonModelSessionIds(result: EndDayResult): readonly string[] {
  const failed = result.failedCaptures.map((failure) => failure.sessionId);
  const nonModelCaptured = result.captured
    .filter((captured) => captured.handoff.source !== 'model')
    .map((captured) => captured.handoff.sessionId);
  return [...failed, ...nonModelCaptured];
}
