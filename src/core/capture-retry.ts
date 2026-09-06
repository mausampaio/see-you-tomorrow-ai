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
 * The **default** for `Config.maxCaptureAttemptsPerSessionPerDay` (`core/types.ts`) — chosen
 * conservatively, per S4-T3's own brief ("se não houver base para escolher, escolha o mais
 * conservador"): the spec gives no number to work from, and the failure this guards against is a
 * REAL money cost (a `claude -p` call that fails for a structural reason — quota, network, a down
 * endpoint — fails identically on every retry). **3** means at most 3 calls wasted on a session
 * that can never succeed today, while still tolerating a single transient blip (one dropped
 * connection) without giving up on the first try — the active-turn retry window
 * (docs/ESPECIFICACAO.md, 5 minutes at the daemon's 30s poll cadence) allows up to ~10 polls, so 3
 * also guarantees the exhaustion path actually engages before that window's own natural ceiling,
 * rather than being a number the window would never reach in practice.
 *
 * **D-035 moved this from a hardcoded constant to a config field** — "depende do quanto ela topa
 * gastar" is a preference, not a technical fact — but the number this module used to enforce
 * directly still has to live SOMEWHERE as the fallback `sessionsExhaustedToday` uses when a caller
 * doesn't pass one (every existing unit test, and any future caller that doesn't care about the
 * exact ceiling). `core/` cannot import `adapters/storage/config-schema.ts` (docs/ARQUITETURA.md's
 * layer matrix) to share its `CONFIG_DEFAULTS.maxCaptureAttemptsPerSessionPerDay` instead, so both
 * modules independently pin the same literal — the same "each layer re-pins the same documented
 * number" convention `scheduler/`'s own `POLL_INTERVAL_MS` already uses for the same reason.
 */
export const MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY = 3;

/**
 * Which `sessionId`s have already used up today's retry budget — `scheduler/capture-filter.ts`
 * turns this into an `EndDayOptions.sessionFilter` exclusion for the NEXT `endDay` call, so a
 * hopeless session stops being re-attempted while every other session keeps its own, independent
 * budget.
 *
 * `maxAttempts` defaults to `MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY` and exists as a parameter
 * (not read from the module constant directly) for the same reason
 * `adapters/git/git-adapter.ts#GitAdapter.readEvidenceAcrossRepos`'s `maxRootsToVisit` does: the
 * real caller (`scheduler/poll.ts`) passes `Config.maxCaptureAttemptsPerSessionPerDay` (D-035), and
 * a test proving the boundary is respected can pass a small number instead of recreating the
 * production default.
 */
export function sessionsExhaustedToday(
  state: DayState,
  maxAttempts: number = MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY,
): ReadonlySet<string> {
  const exhausted = new Set<string>();
  for (const [sessionId, attempts] of Object.entries(state.captureAttemptsToday)) {
    if (attempts >= maxAttempts) {
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
