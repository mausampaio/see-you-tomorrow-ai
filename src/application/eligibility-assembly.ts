/**
 * Assembles `core/eligibility.ts#EligibilityCriteria` for one session, in two stages: a cheap
 * stage that needs no I/O, and a full stage (D-026's anti-duplication) that needs today's previous
 * handoff, if any. Splitting it this way is what lets `application/capture-session.ts` skip
 * git/transcript reads entirely for a session an ignore-list entry or a stale `lastActivity`
 * already disqualifies (docs/ESPECIFICACAO.md § "Elegibilidade": five conditions, but only the
 * fifth needs fresh evidence).
 */
import type { Storage } from '../core/ports.js';
import type { Config, Day, DiscoveredSession, HandoffFacts, ProjectPolicy } from '../core/types.js';
import {
  evaluateEligibility,
  type EligibilityCriteria,
  type EligibilityResult,
} from '../core/eligibility.js';
import { normalizeCwdForComparison, type PathPlatformHint } from '../core/cwd-normalization.js';
import { buildEvidenceSignature, type EvidenceSignature } from '../core/evidence.js';

const EMPTY_SIGNATURE: EvidenceSignature = {};

/** Real environment read once, here — `application/` cannot import `adapters/` (D-020), but
 * `process.platform` is a Node global, not an adapter: reading it directly is the same kind of
 * thing `new Date(valor)` already is (D-019's distinction) — using data already in hand, not
 * performing I/O. See `core/cwd-normalization.ts`'s own docstring for why the platform is a plain
 * parameter there instead of being read inside `core/`. */
const PLATFORM_HINT: PathPlatformHint = process.platform === 'win32' ? 'win32' : 'posix';

/**
 * `config.ignore`'s entries, normalized the same way `withComparableCwd` normalizes a session's
 * own `cwd` below — comparing a raw ignore entry against a raw `session.cwd` is exactly the S3-T5
 * bug: two spellings of the same directory (different separator, different case on Windows, a
 * trailing slash) silently fail to match, and a session on the ignore list keeps showing up as
 * eligible with no visible reason why the config entry "isn't working".
 *
 * Exported: `cli/eligibility-view.ts#countEligibleSessions` (the `seeya status` count) needs the
 * exact same normalization for the exact same comparison — `cli/` importing `application/` is
 * permitted (D-020), and a second copy of this function would be the duplication AGENTS.md rules
 * out, not a reasonable amount of coupling.
 */
export function normalizedIgnoreSet(config: Config): ReadonlySet<string> {
  return new Set(config.ignore.map((cwd) => normalizeCwdForComparison(cwd, PLATFORM_HINT)));
}

/**
 * A session whose `cwd` has been run through the same normalization as `normalizedIgnoreSet`
 * above, for the ONE comparison `core/eligibility.ts#evaluateEligibility` makes
 * (`criteria.ignoredCwds.has(session.cwd)`) — core does exact string equality on purpose (its own
 * docstring: "core/ can't import node:path ... normalization is the responsibility of code
 * outside the core"), so both sides of that comparison have to already agree on a shape before
 * they get there. Branches on `hasPid` (rather than one generic object-spread) so each branch's
 * spread type is a concrete `SessionWithPid`/`SessionWithoutPid`, not a union — cheaper for
 * TypeScript to check and avoids relying on how well it distributes a spread over a union type.
 * Nothing but this function's own return value ever sees the normalized `cwd`: the original
 * `session` (with its real `cwd`, used for display, facts and the handoff) is untouched.
 *
 * Exported for the same reason as `normalizedIgnoreSet` above.
 */
export function withComparableCwd(session: DiscoveredSession): DiscoveredSession {
  const cwd = normalizeCwdForComparison(session.cwd, PLATFORM_HINT);
  return session.hasPid ? { ...session, cwd } : { ...session, cwd };
}

const DEFAULT_PROJECT_POLICY: ProjectPolicy = { canTerminate: false, deepCapture: false };

/**
 * Always empty, on purpose (docs/QUESTOES.md Q-021, item 5) — see `evaluateCheapEligibility`'s
 * docstring for why: both discovery strategies (S1-T3, S1-T8) already exclude `forks.json`'s
 * sessions before a fork ever reaches `endDay`.
 *
 * **Second-order risk this hides, written down for whoever touches discovery next.** This
 * constant is what makes `ownSeeyaFork` structurally unreachable from `endDay` TODAY, based on an
 * invariant that lives entirely upstream, in `adapters/discovery/`. If a future change to either
 * discovery strategy stops excluding forks — a refactor that drops the `forks.json` check, a new
 * third strategy that forgets it — eligibility filtering for forks does not fail loudly: it just
 * stops happening, silently, because this constant never queries `forks.json` to find out whether
 * the invariant still holds. The filter lives upstream of this file, not in it.
 */
const NO_KNOWN_FORKS: ReadonlySet<string> = new Set();

/** `config.projectPolicy[cwd]`, defaulted the same opt-in way `config-schema.ts#resolveProjectPolicy`
 * already fills a policy that mentions only one of the two flags (D-002/D-011: silence means
 * "not opted in"), extended to a `cwd` the config doesn't mention at all. */
export function projectPolicyFor(config: Config, cwd: string): ProjectPolicy {
  return config.projectPolicy[cwd] ?? DEFAULT_PROJECT_POLICY;
}

/**
 * The four conditions `evaluateEligibility` can decide from `session` and `config` alone
 * (docs/ESPECIFICACAO.md § "Elegibilidade"'s first four) — no I/O, so a session an ignore-list
 * entry or a stale `lastActivity` already disqualifies never costs a git/transcript read.
 *
 * `knownForks` is `NO_KNOWN_FORKS` (always empty) — both discovery strategies (S1-T3, S1-T8)
 * already exclude `forks.json`'s sessions before `SessionProvider.list()` ever returns them
 * (D-012). The pure rule still has its own `ownSeeyaFork` check (exercised directly by
 * `core/eligibility.ts`'s own unit tests) — from `endDay`'s side, that condition is structurally
 * unreachable, so re-reading `forks.json` here to populate a set that could never change the
 * outcome would be I/O spent proving something discovery already guarantees. See
 * `NO_KNOWN_FORKS`'s own docstring for the risk this carries if that upstream guarantee ever
 * breaks.
 */
export function evaluateCheapEligibility(
  session: DiscoveredSession,
  now: Date,
  config: Config,
): EligibilityResult {
  return evaluateEligibility(withComparableCwd(session), {
    now,
    relevanceHours: config.relevanceHours,
    ignoredCwds: normalizedIgnoreSet(config),
    knownForks: NO_KNOWN_FORKS,
    previousCaptureToday: null,
    currentSignature: EMPTY_SIGNATURE,
  });
}

/**
 * The full check, once fresh evidence (`currentFacts`) has been gathered — adds D-026's
 * anti-duplication, the one condition the cheap stage can't decide without reading today's
 * previous handoff for this session, if any (`Storage.readHandoff`). Lets that read's own
 * corruption error (a malformed handoff on disk) propagate rather than swallowing it: same policy
 * every other `Storage` read in this project follows — corruption is a visible failure, never
 * silently treated as "nothing captured yet" (D-025).
 *
 * Passes the stored handoff's `source` through to `PreviousCaptureToday` untouched (S4-T00e) —
 * this function only resolves the I/O (which handoff, if any, exists today); which sources count
 * as "already captured" for anti-duplication purposes is part of the eligibility rule itself, so
 * that decision is made once, in `core/eligibility.ts#evaluateEligibility`, not here.
 */
export async function evaluateFullEligibility(
  session: DiscoveredSession,
  now: Date,
  config: Config,
  storage: Storage,
  day: Day,
  currentFacts: HandoffFacts,
): Promise<EligibilityResult> {
  const previousHandoff = await storage.readHandoff(day, session.sessionId);
  const criteria: EligibilityCriteria = {
    now,
    relevanceHours: config.relevanceHours,
    ignoredCwds: normalizedIgnoreSet(config),
    knownForks: NO_KNOWN_FORKS,
    previousCaptureToday:
      previousHandoff === null
        ? null
        : {
            signature: buildEvidenceSignature(previousHandoff.facts),
            source: previousHandoff.source,
          },
    currentSignature: buildEvidenceSignature(currentFacts),
  };
  return evaluateEligibility(withComparableCwd(session), criteria);
}
