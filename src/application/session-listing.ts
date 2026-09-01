/**
 * D-031's listing side of `endDay`: turns every session `core/capture-scope.ts#isCaptureCandidate`
 * excluded into a `core/types.ts#SessionListing`, reading each one's `ai-title`/`last-prompt`
 * through `TranscriptReader.readListingInfo` (`core/ports.ts`). Kept as its own tiny module rather
 * than folded into `end-day.ts` — it's a distinct concern (identifying a session for display, never
 * capturing it) with its own reasoning about failure below, not a natural fit for that file's own
 * ~20-line-per-function budget once documented.
 */
import type { TranscriptReader } from '../core/ports.js';
import type { DiscoveredSession, SessionListing, SessionListingInfo } from '../core/types.js';

/**
 * One session's `SessionListingInfo` (S4-T0c). A `readListingInfo` failure (a real I/O error — the
 * port's own contract already treats "no transcript found" as `{ aiTitle: null, lastPrompt: null }`,
 * not a rejection) becomes `{ kind: 'unreadable', reason }` instead of propagating OR silently
 * degrading to the same shape an ordinary absent title gets (the bug Q-041's `--session` follow-up
 * found: before this task, both cases produced `{ aiTitle: null, lastPrompt: null }`, and a reader
 * had no way to tell "nobody wrote a title" from "seeya couldn't check"). The listing stays
 * informational either way — D-031's whole point is identifying a session for a human, nothing
 * more — so a transcript this project can't currently read for one out-of-scope session still must
 * never take down `endDay`'s real job — capturing the sessions that ARE in scope. This mirrors the
 * discipline `core/ports.ts#Notifier.notify()` already documents for the same class of reason: a
 * courtesy never gets to abort the thing it's a courtesy about; it can still say so honestly.
 */
async function readListingInfo(
  transcriptReader: TranscriptReader,
  session: DiscoveredSession,
): Promise<SessionListingInfo> {
  try {
    const { aiTitle, lastPrompt } = await transcriptReader.readListingInfo(session);
    return { kind: 'read', aiTitle, lastPrompt };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: 'unreadable', reason };
  }
}

/** One session's listing entry — identity from `session`, title/prompt (or the reason reading them
 * failed) from `readListingInfo` above. */
async function buildOneListing(
  transcriptReader: TranscriptReader,
  session: DiscoveredSession,
): Promise<SessionListing> {
  const info = await readListingInfo(transcriptReader, session);
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    name: session.name,
    info,
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
