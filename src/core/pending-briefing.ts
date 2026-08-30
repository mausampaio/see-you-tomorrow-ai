/**
 * Decides whether a `Briefing` (`core/ports.ts`, S3-T1) still has work worth resuming — the
 * predicate `seeya start-day`'s step 1 needs, "Lê o briefing mais recente que ainda tem
 * pendências" (docs/ESPECIFICACAO.md § `seeya start-day`).
 *
 * docs/PLANO-DE-ENTREGA.md's S3-T1 leaves "ainda tem pendências" undefined; docs/QUESTOES.md
 * Q-026 registers the choice made here for confirmation. **The definition is content-based, not a
 * bookkeeping flag.** Nothing persisted today tracks "this day was already resumed" — that lands
 * with whatever implements step 5 ("marca o briefing como retomado", D-004), out of this task's
 * scope — so the only honest signal available right now is what each handoff actually recorded.
 *
 * **D-025 drives the rule for a single handoff.** A handoff whose `source` isn't `"model"`
 * (`"deterministic"` or `"noTranscript"`) never had the model confirm "nothing is pending" —
 * `application/generation-policy.ts`'s `deterministicOutcome`/the `noTranscript` path both leave
 * `pendingItems`/`tomorrowPlan` at `[]` as an artifact of the failure/skip, not as a claim that
 * nothing is left. Absence of a model verdict is not the same as a verdict of "done", so a
 * non-`model` handoff always counts as still pending, no matter how empty its lists look. Only a
 * `source: "model"` handoff — where the model was actually asked and explicitly answered — can
 * count as resolved, and only when it explicitly reported nothing pending.
 */
import type { Briefing } from './ports.js';
import type { Handoff } from './types.js';

/**
 * @example
 * handoffStillPending(deterministicHandoff) // true, even with pendingItems: [] (D-025)
 * handoffStillPending(modelHandoffWithNoPendingItems) // false — the model actually said so
 */
export function handoffStillPending(handoff: Handoff): boolean {
  if (handoff.source !== 'model') {
    return true;
  }
  return handoff.pendingItems.length > 0 || handoff.tomorrowPlan.length > 0;
}

/**
 * A briefing "ainda tem pendências" when at least one of its handoffs does. A day with handoffs
 * but none pending (every session's model run explicitly confirmed nothing left) is a real,
 * resolved day — not treated as pending just because handoffs exist for it.
 *
 * @example
 * briefingStillPending({ day: '2026-08-16', handoffs: [], rejected: [] }) // false
 */
export function briefingStillPending(briefing: Briefing): boolean {
  return briefing.handoffs.some(handoffStillPending);
}
