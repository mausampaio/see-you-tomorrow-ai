/**
 * `seeya start-day`'s step 1 (docs/ESPECIFICACAO.md § `seeya start-day`): "Lê o briefing mais
 * recente que ainda tem pendências." Walks backward one local calendar day at a time from
 * `clock.now()` (D-019: the instant comes from the injected `Clock`, never read here), stopping
 * at the first day whose `Briefing` (`Storage.readBriefing`, S3-T1) has at least one handoff
 * `core/pending-briefing.ts#briefingStillPending` calls pending — see that module's own docstring
 * for why the check is content-based rather than a "already resumed" flag (nothing persists that
 * yet, docs/QUESTOES.md Q-026).
 *
 * **The walk is bounded, on purpose (docs/QUESTOES.md Q-026).** docs/ESPECIFICACAO.md says "o
 * briefing mais recente", not "o mais antigo que exista". A briefing from three weeks ago, found
 * only because nobody ran `seeya start-day` since, is not "yesterday's plan" — resuming it as if
 * it were would hand a stale prompt to a session whose `cwd` may not even match reality anymore
 * (moved, renamed, branch gone). `MAX_BRIEFING_LOOKBACK_DAYS` picks the same width this project
 * already uses elsewhere for "how long is stale evidence still worth acting on"
 * (`Config.forkCleanupDays`'s default of 7, D-012) instead of inventing a second, unrelated
 * number. Past that horizon, "no pending briefing" is the honest answer (D-025), not a stretch
 * further back to find *something*.
 */
import { subtractLocalDays, localDayString } from '../core/day.js';
import { briefingStillPending } from '../core/pending-briefing.js';
import type { Briefing, Clock, Storage } from '../core/ports.js';

/** Same width as `Config.forkCleanupDays`'s default (D-012) — see this module's own docstring for
 * why that number, not a new one, anchors this search too. */
export const MAX_BRIEFING_LOOKBACK_DAYS = 7;

/**
 * `findPendingBriefing`'s result — a discriminated union (D-024), not `Briefing | null`, so a
 * caller can tell "found nothing" from "found nothing, and here's how far back it looked" without
 * inventing a sentinel `Briefing`. `daysSearched` lets `seeya start-day` (S3-T3) say something
 * honest ("no pending briefing in the last 8 days") instead of a bare "nothing found" (D-025) —
 * acceptance criterion "nenhum briefing pendente é caso normal, não erro" lands here as a value,
 * never a thrown error.
 */
export type PendingBriefingLookup =
  | { readonly found: true; readonly briefing: Briefing }
  | { readonly found: false; readonly daysSearched: number };

/**
 * @example
 * const lookup = await findPendingBriefing(storage, clock);
 * if (lookup.found) {
 *   const prompts = buildResumePrompts(lookup.briefing); // core/resume-prompt.ts
 * }
 */
export async function findPendingBriefing(
  storage: Storage,
  clock: Clock,
  maxLookbackDays: number = MAX_BRIEFING_LOOKBACK_DAYS,
): Promise<PendingBriefingLookup> {
  const today = clock.now();
  for (let offset = 0; offset <= maxLookbackDays; offset += 1) {
    const day = localDayString(subtractLocalDays(today, offset));
    const briefing = await storage.readBriefing(day);
    if (briefing !== null && briefingStillPending(briefing)) {
      return { found: true, briefing };
    }
  }
  return { found: false, daysSearched: maxLookbackDays + 1 };
}
