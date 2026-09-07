/**
 * S4-T7's pure decision: whether a `leadTimeWarning` notice that just became due should be
 * swallowed because another notice of the SAME class already went out too recently
 * (docs/PLANO-DE-ENTREGA.md S4-T7: "um aviso não sai se outro do mesmo tipo saiu há menos de N
 * minutos"). No I/O, no `new Date()`/`Date.now()` (D-019) — `now` and `lastFiredAt` both arrive
 * already resolved, the same discipline every other `core/` decision in this project follows.
 *
 * **This does NOT change when a lead-time rule wins (docs/PLANO-DE-ENTREGA.md S4-T7: "não mude
 * quando as regras vencem").** `core/schedule.ts#decideSchedule` and its own
 * `firedLeadTimesInMinutes` bookkeeping are unchanged by this task — that decides which configured
 * rule is due and marks it as having fired, for good, the moment it's due. This function answers a
 * different, later question: given that a `leadTimeWarning` IS due, should the notice actually
 * reach the person, or would it just be near-duplicate noise on top of one shown moments ago?
 * `scheduler/poll.ts` is the only caller, and only from the `leadTimeWarning` branch.
 */

/**
 * `lastFiredAt: null` — D-025: a day where no `leadTimeWarning` notice has gone out yet is the
 * ordinary start-of-day case, never read as "one just fired". Always returns `false` for it, so the
 * first lead-time warning of the day is never swallowed (docs/PLANO-DE-ENTREGA.md S4-T7's own
 * acceptance: "o primeiro aviso do dia nunca é engolido").
 *
 * `<` at the boundary, not `<=`: `minGapMinutes` is documented as a MINIMUM gap
 * (`core/types.ts#Config.leadTimeHysteresisMinutes`) — a gap of exactly that many minutes has
 * already satisfied "at least N minutes apart", so only a STRICTLY smaller gap counts as too soon.
 *
 * @example
 * const suppress = shouldSuppressLeadTimeWarning(state.lastLeadTimeWarningNoticeAt, now, config.leadTimeHysteresisMinutes);
 * if (!suppress) await notifier.notify(buildLeadTimeNotice(remaining, day));
 */
export function shouldSuppressLeadTimeWarning(
  lastFiredAt: Date | null,
  now: Date,
  minGapMinutes: number,
): boolean {
  if (lastFiredAt === null) {
    return false;
  }
  const gapMinutes = (now.getTime() - lastFiredAt.getTime()) / 60_000;
  return gapMinutes < minGapMinutes;
}
