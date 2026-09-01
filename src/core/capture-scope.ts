/**
 * D-031's scope cut: which discovered sessions are candidates for the day's capture at all —
 * decided BEFORE `core/eligibility.ts` ever runs (S4-T00e owns that file and
 * `application/eligibility-assembly.ts`; this module deliberately doesn't touch either). The five
 * eligibility conditions describe a session that is already in scope; "should this session even be
 * a candidate" is a different question, asked first, not a sixth condition mixed into that one
 * (docs/PLANO-DE-ENTREGA.md S4-T0b).
 *
 * **The three populations D-031 names, and the sign that separates them (Spike E):**
 *
 * | situation | meaning | scope |
 * |---|---|---|
 * | record + live PID (`alive`/`idle`) | session is alive | **capture** |
 * | record + dead PID (`ended`) | died WITHOUT a graceful exit | **capture** |
 * | transcript only, no record (`unknown`) | exited gracefully: the person closed it | **list** |
 *
 * **Why `hasPid` alone is exactly this cut, with no new field needed on `DiscoveredSession`.**
 * `adapters/discovery/registry.ts`'s schema requires `pid`, so every session the registry strategy
 * produces is a `SessionWithPid` regardless of whether the process is still alive — a stale record
 * entry (D-016: "entrada obsoleta... ainda merece handoff") stays `SessionWithPid` with
 * `processIsAlive: false`. The transcript-scan strategy (`transcript-scan.ts`) never produces
 * anything but `SessionWithoutPid` — a `.jsonl` file alone never carries a PID. The merge step
 * (`adapters/discovery/merge.ts#fuseSession`) only upgrades a session to `SessionWithPid` when the
 * registry itself saw it; a session the registry never saw stays `SessionWithoutPid` no matter what
 * the transcript scan found. So the union's own discriminant already tracks D-031's populations
 * exactly: `classifyState` (`core/classification.ts`) returns `unknown` if and only if
 * `!session.hasPid`, and `alive`/`idle`/`ended` if and only if `session.hasPid` — the same
 * discriminant this function reads, not a coincidence, since both this predicate and
 * `classifyState` start from the same "is there a record to check liveness against at all" fact.
 */
import type { DiscoveredSession } from './types.js';

/**
 * `true` for a session `endDay` should attempt to capture; `false` for a session D-031 moves to
 * the day's listing instead (`core/types.ts#SessionListing`).
 *
 * @example
 * const captureCandidates = discovery.sessions.filter(isCaptureCandidate);
 * const listed = discovery.sessions.filter((session) => !isCaptureCandidate(session));
 */
export function isCaptureCandidate(session: DiscoveredSession): boolean {
  return session.hasPid;
}
