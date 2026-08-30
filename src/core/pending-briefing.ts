/**
 * Decides whether a `Briefing` (`core/ports.ts`, S3-T1) still has work worth resuming — the
 * predicate `seeya start-day`'s step 1 needs, "Lê o briefing mais recente que ainda tem
 * pendências" (docs/ESPECIFICACAO.md § `seeya start-day`).
 *
 * **"Pendente" is now "não retomado E com conteúdo" (S3-T3, closing the gap docs/QUESTOES.md
 * Q-026 left open).** Q-026's original answer defined "pending" by content alone and called that
 * rule explicitly interim, because nothing persisted "this session was resumed" yet. That gap is
 * closed: `Storage.readResumedSessionIds(day)` (`core/ports.ts`) is the per-day, per-SESSION
 * record `application/start-day.ts#resumeSessions` writes right after each
 * `SessionResumer.resume()` call actually completes — never before (D-002's "fact, then mark"
 * ordering, applied here to persistence instead of process termination). `handoffStillPending`/
 * `briefingStillPending` below take that set as a parameter and check it first: a resumed session
 * is never pending again, whatever its content says.
 *
 * **Marked per session, not per day — the decision that matters most here.** A day can have
 * several handoffs. If resuming just one of them marked the whole DAY as "done", the other,
 * still-untouched handoffs would silently disappear from `findPendingBriefing`'s notion of
 * "pending" — read by anyone as "confirmed nothing left", which is exactly D-025's mistake, aimed
 * at a whole day of a person's work instead of one field. Keying by `sessionId` means a
 * partially-resumed day stays visibly pending until every one of its sessions has actually been
 * resumed.
 *
 * **D-025 still drives the content half of the rule.** A handoff whose `source` isn't `"model"`
 * (`"deterministic"` or `"noTranscript"`) never had the model confirm "nothing is pending" —
 * `application/generation-policy.ts`'s `deterministicOutcome`/the `noTranscript` path both leave
 * `pendingItems`/`tomorrowPlan` at `[]` as an artifact of the failure/skip, not as a claim that
 * nothing is left. Absence of a model verdict is not the same as a verdict of "done", so a
 * non-`model`, not-yet-resumed handoff always counts as still pending, no matter how empty its
 * lists look. Only a `source: "model"` handoff that explicitly reported nothing pending — or one
 * already resumed, regardless of what it reported — counts as resolved.
 */
import type { Briefing } from './ports.js';
import type { Handoff } from './types.js';

/**
 * @example
 * handoffStillPending(deterministicHandoff, new Set()) // true, even with pendingItems: [] (D-025)
 * handoffStillPending(modelHandoffWithNoPendingItems, new Set()) // false — the model said so
 * handoffStillPending(modelHandoffWithPendingItems, new Set([handoff.sessionId])) // false: resumed
 */
export function handoffStillPending(
  handoff: Handoff,
  resumedSessionIds: ReadonlySet<string> = new Set(),
): boolean {
  if (resumedSessionIds.has(handoff.sessionId)) {
    return false;
  }
  if (handoff.source !== 'model') {
    return true;
  }
  return handoff.pendingItems.length > 0 || handoff.tomorrowPlan.length > 0;
}

/**
 * A briefing "ainda tem pendências" when at least one of its handoffs does — see
 * `handoffStillPending` above for what that means per session.
 *
 * @example
 * briefingStillPending({ day: '2026-08-16', handoffs: [], rejected: [] }, new Set()) // false
 */
export function briefingStillPending(
  briefing: Briefing,
  resumedSessionIds: ReadonlySet<string> = new Set(),
): boolean {
  return briefing.handoffs.some((handoff) => handoffStillPending(handoff, resumedSessionIds));
}

/**
 * The candidate set `seeya start-day`'s step 3 (the interactive picker, or `--all`) offers —
 * every handoff in `briefing` not yet marked resumed for that day, regardless of what
 * `handoffStillPending` would say about its content.
 *
 * **Deliberately a DIFFERENT filter than "pending".** A `source: "model"` handoff the model
 * confirmed clean is not "pending" by content, but if nobody has resumed it yet it is still a
 * real, unactioned choice worth offering — narrowing the picker to only content-pending sessions
 * would quietly take that choice away. Conversely, a handoff already resumed is worth hiding
 * regardless of content, so the same session isn't offered — and re-resumed — twice by an
 * `--all` run after a partial one earlier the same day.
 *
 * @example
 * unresumedHandoffs(briefing, new Set(['already-done-id'])) // every OTHER handoff in briefing
 */
export function unresumedHandoffs(
  briefing: Briefing,
  resumedSessionIds: ReadonlySet<string>,
): readonly Handoff[] {
  return briefing.handoffs.filter((handoff) => !resumedSessionIds.has(handoff.sessionId));
}
