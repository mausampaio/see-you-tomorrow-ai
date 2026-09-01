/**
 * D-031's listing side of `endDay`: turns every session `core/capture-scope.ts#isCaptureCandidate`
 * excluded into a `core/types.ts#SessionListing`, reading each one's `ai-title`/`last-prompt`
 * through `TranscriptReader.readListingInfo` (`core/ports.ts`). Kept as its own tiny module rather
 * than folded into `end-day.ts` — it's a distinct concern (identifying a session for display, never
 * capturing it) with its own reasoning about failure below, not a natural fit for that file's own
 * ~20-line-per-function budget once documented.
 */
import type { TranscriptReader } from '../core/ports.js';
import type { DiscoveredSession, SessionListing } from '../core/types.js';

const NO_TITLE: { readonly aiTitle: null; readonly lastPrompt: null } = {
  aiTitle: null,
  lastPrompt: null,
};

/**
 * One session's listing entry. A `readListingInfo` failure (a real I/O error — the port's own
 * contract already treats "no transcript found" as `{ aiTitle: null, lastPrompt: null }`, not a
 * rejection) degrades to the same "no title" shape instead of propagating: the listing is
 * informational (D-031's whole point is identifying a session for a human, nothing more), and a
 * transcript this project can't currently read for one out-of-scope session must never take down
 * `endDay`'s real job — capturing the sessions that ARE in scope. This mirrors the discipline
 * `core/ports.ts#Notifier.notify()` already documents for the same class of reason: a courtesy
 * never gets to abort the thing it's a courtesy about.
 */
async function buildOneListing(
  transcriptReader: TranscriptReader,
  session: DiscoveredSession,
): Promise<SessionListing> {
  const info = await transcriptReader.readListingInfo(session).catch(() => NO_TITLE);
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    name: session.name,
    aiTitle: info.aiTitle,
    lastPrompt: info.lastPrompt,
  };
}

/**
 * Builds every listing entry for `sessions` — expected to already be narrowed to the
 * out-of-scope population (`!isCaptureCandidate(session)`), though this function doesn't re-check
 * that itself: `end-day.ts` is the one place that partitions discovery's output, and duplicating
 * the check here would just be a second place that could drift from the first.
 *
 * @example
 * const listedSessions = await buildSessionListings(deps.transcriptReader, outOfScopeSessions);
 */
export function buildSessionListings(
  transcriptReader: TranscriptReader,
  sessions: readonly DiscoveredSession[],
): Promise<SessionListing[]> {
  return Promise.all(sessions.map((session) => buildOneListing(transcriptReader, session)));
}
