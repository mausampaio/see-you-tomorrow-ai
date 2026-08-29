/**
 * Pure "how many discovered sessions are eligible right now" for `seeya status`
 * (docs/ESPECIFICACAO.md § "seeya status": "quantas sessões estão elegíveis").
 *
 * **Reduced scope, tracked in docs/QUESTOES.md Q-015.** `evaluateEligibility`'s full contract
 * (`core/eligibility.ts`) needs `knownForks` and `previousCaptureToday`:
 *
 * - `knownForks` is always empty here, and correctly so — discovery (D-012) has already excluded
 *   every fork before a `DiscoveredSession` ever reaches this function, so by the time `sessions`
 *   arrives there is nothing left to exclude a second time.
 * - `previousCaptureToday` is always `null`, and that is also the literal truth today, not a
 *   shortcut: no handoff has ever been written by this build (`endDay`, S2-T3, doesn't exist yet),
 *   so no session genuinely has a "capture from today" to compare against.
 *
 * Once `Storage` grows a way to read today's handoffs (S2-T3/S1-T5), this needs a real
 * `previousCaptureToday` per session — see Q-015 for why that isn't invented here instead.
 */
import { evaluateEligibility } from '../core/eligibility.js';
import type { DiscoveredSession, Config } from '../core/types.js';

export function countEligibleSessions(
  sessions: readonly DiscoveredSession[],
  config: Config,
  now: Date,
): number {
  const ignoredCwds = new Set(config.ignore);
  let eligibleCount = 0;
  for (const session of sessions) {
    const result = evaluateEligibility(session, {
      now,
      relevanceHours: config.relevanceHours,
      ignoredCwds,
      knownForks: new Set(),
      previousCaptureToday: null,
      currentSignature: {},
    });
    if (result.eligible) {
      eligibleCount += 1;
    }
  }
  return eligibleCount;
}
