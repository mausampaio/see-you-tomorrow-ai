/**
 * `seeya start-day`'s step 1 (docs/ESPECIFICACAO.md § `seeya start-day`): "Lê o briefing mais
 * recente que ainda tem pendências." Walks backward one local calendar day at a time from
 * `clock.now()` (D-019: the instant comes from the injected `Clock`, never read here), stopping
 * at the first day whose `Briefing` (`Storage.readBriefing`, S3-T1) has at least one handoff
 * `core/pending-briefing.ts#briefingStillPending` calls pending — see that module's own docstring
 * for why the check is content-based rather than an "already resumed" flag (nothing persists that
 * yet, docs/QUESTOES.md Q-026).
 *
 * **No product-level age cutoff (docs/QUESTOES.md Q-026, revised on review).** An earlier version
 * of this module refused to look back more than a week, reasoning by analogy with
 * `Config.forkCleanupDays`. That analogy doesn't hold: `forkCleanupDays` protects a case where
 * erring toward "too long" costs disk, and erring toward "too short" costs nothing but a stale
 * file. Here, refusing an old-but-still-pending briefing costs the one thing `seeya start-day`
 * exists to hand back — "where was I" for someone who was away two weeks, on vacation or heads
 * down on something else. If it's worth resuming old work, that is the user's call, not this
 * function's. So there is no age past which a real pending briefing stops counting; the caller
 * gets `daysAgo` (how many local days back it was found) and can show that plainly, e.g.
 * "this plan is from 3 weeks ago", and decide.
 *
 * `MAX_BRIEFING_SCAN_DAYS` below is a **disk-I/O bound, not a product judgment** — see its own
 * docstring.
 */
import { subtractLocalDays, localDayString } from '../core/day.js';
import { briefingStillPending } from '../core/pending-briefing.js';
import type { Briefing, Clock, Storage } from '../core/ports.js';

/**
 * How many days back `findPendingBriefing` will call `Storage.readBriefing` looking for a pending
 * day, before giving up. **This is purely a limit on how much disk this function is willing to
 * touch in one call — it carries no claim about how old a briefing may be to still count as
 * pending.** Raising this number doesn't change what "pending" means (`core/pending-briefing.ts`
 * decides that on its own, by content); it only changes how far back this function is willing to
 * search for one. Picked generously (30 days, a bit over a typical vacation plus slack) precisely
 * because it is NOT the thing doing the judging — the content check is. If a real pending briefing
 * sits further back than this, `findPendingBriefing` won't find it and reports `found: false`;
 * that's this function's own honest limit (D-025: it doesn't claim "no pending briefing exists",
 * only "none was found within the days scanned" — see `daysSearched` on the `found: false` case).
 */
export const MAX_BRIEFING_SCAN_DAYS = 30;

/**
 * `findPendingBriefing`'s result — a discriminated union (D-024), not `Briefing | null`, so a
 * caller can tell "found nothing" from "found nothing, and here's how far back it looked" without
 * inventing a sentinel `Briefing`. `daysSearched` lets `seeya start-day` (S3-T3) say something
 * honest ("no pending briefing in the last 31 days scanned") instead of a bare "nothing found"
 * (D-025) — acceptance criterion "nenhum briefing pendente é caso normal, não erro" lands here as
 * a value, never a thrown error.
 *
 * `daysAgo` on the `found: true` case is how many local calendar days back the briefing sits
 * relative to `clock.now()` (`0` = today, `1` = yesterday, …) — the raw number `seeya start-day`
 * needs to tell the user plainly when the plan they're about to see is NOT from yesterday (Q-026).
 */
export type PendingBriefingLookup =
  | { readonly found: true; readonly briefing: Briefing; readonly daysAgo: number }
  | { readonly found: false; readonly daysSearched: number };

/**
 * @example
 * const lookup = await findPendingBriefing(storage, clock);
 * if (lookup.found) {
 *   const plan = renderConsolidatedPlan(lookup.briefing, lookup.daysAgo); // core/consolidated-plan.js
 *   const prompts = buildResumePrompts(lookup.briefing); // core/resume-prompt.js
 * }
 */
export async function findPendingBriefing(
  storage: Storage,
  clock: Clock,
  maxScanDays: number = MAX_BRIEFING_SCAN_DAYS,
): Promise<PendingBriefingLookup> {
  const today = clock.now();
  for (let offset = 0; offset <= maxScanDays; offset += 1) {
    const day = localDayString(subtractLocalDays(today, offset));
    const briefing = await storage.readBriefing(day);
    if (briefing !== null && briefingStillPending(briefing)) {
      return { found: true, briefing, daysAgo: offset };
    }
  }
  return { found: false, daysSearched: maxScanDays + 1 };
}
