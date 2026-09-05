/**
 * S4-T3's daemon-only capture retry budget (docs/QUESTOES.md Q-040 item 3, `core/types.ts`'s
 * `DayState.captureAttemptsToday` docstring has the full "why this counter exists" reasoning — this
 * file is the pure decision half: given the counts, which sessions are exhausted, and how to update
 * the counts after one `application/endDay` call).
 *
 * No I/O here — `scheduler/poll.ts` is what calls `application/endDay`, reads its
 * `EndDayResult.failedCaptures`/`captured`, and turns them into the plain `sessionId` list this
 * file's `recordCaptureAttempts` takes.
 */
import type { DayState } from './types.js';

/**
 * How many non-model-sourced attempts a single session gets in one local day before the daemon
 * stops retrying it. Chosen conservatively, per S4-T3's own brief ("se não houver base para
 * escolher, escolha o mais conservador"): the spec gives no number to work from, and the failure
 * this guards against is a REAL money cost (a `claude -p` call that fails for a structural reason —
 * quota, network, a down endpoint — fails identically on every retry). **3** means at most 3 calls
 * wasted on a session that can never succeed today, while still tolerating a single transient
 * blip (one dropped connection) without giving up on the first try — the active-turn retry window
 * (docs/ESPECIFICACAO.md, 5 minutes at the daemon's 30s poll cadence) allows up to ~10 polls, so 3
 * also guarantees the exhaustion path actually engages before that window's own natural ceiling,
 * rather than being a number the window would never reach in practice.
 */
export const MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY = 3;

/**
 * Which `sessionId`s have already used up today's retry budget — `scheduler/capture-filter.ts`
 * turns this into an `EndDayOptions.sessionFilter` exclusion for the NEXT `endDay` call, so a
 * hopeless session stops being re-attempted while every other session keeps its own, independent
 * budget.
 */
export function sessionsExhaustedToday(state: DayState): ReadonlySet<string> {
  const exhausted = new Set<string>();
  for (const [sessionId, attempts] of Object.entries(state.captureAttemptsToday)) {
    if (attempts >= MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY) {
      exhausted.add(sessionId);
    }
  }
  return exhausted;
}

/**
 * Increments today's attempt count for every `sessionId` in `nonModelSessionIds` — the caller's
 * job to have already filtered `EndDayResult` down to failed captures plus captured-but-not-`model`
 * handoffs (`core/types.ts#DayState.captureAttemptsToday`'s own docstring explains why only those
 * count). A `sessionId` not in the list keeps its existing count untouched — this function never
 * resets or decrements, only the day rolling over does that (`core/schedule.ts#emptyDayState`).
 *
 * @example
 * const nextState = recordCaptureAttempts(state, ['session-a', 'session-b']);
 * // both sessions' counts go up by 1; every other session's count is unchanged.
 */
export function recordCaptureAttempts(
  state: DayState,
  nonModelSessionIds: readonly string[],
): DayState {
  if (nonModelSessionIds.length === 0) {
    return state;
  }
  const updated: Record<string, number> = { ...state.captureAttemptsToday };
  for (const sessionId of nonModelSessionIds) {
    updated[sessionId] = (updated[sessionId] ?? 0) + 1;
  }
  return { ...state, captureAttemptsToday: updated };
}
