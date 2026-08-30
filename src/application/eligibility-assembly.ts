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
import { buildEvidenceSignature, type EvidenceSignature } from '../core/evidence.js';

const EMPTY_SIGNATURE: EvidenceSignature = {};

const DEFAULT_PROJECT_POLICY: ProjectPolicy = { canTerminate: false, deepCapture: false };

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
 * `knownForks` is always empty: both discovery strategies (S1-T3, S1-T8) already exclude
 * `forks.json`'s sessions before `SessionProvider.list()` ever returns them (D-012). The pure rule
 * still has its own `ownSeeyaFork` check (exercised directly by `core/eligibility.ts`'s own unit
 * tests) — from `endDay`'s side, that condition is structurally unreachable, so re-reading
 * `forks.json` here to populate a set that could never change the outcome would be I/O spent
 * proving something discovery already guarantees.
 */
export function evaluateCheapEligibility(
  session: DiscoveredSession,
  now: Date,
  config: Config,
): EligibilityResult {
  return evaluateEligibility(session, {
    now,
    relevanceHours: config.relevanceHours,
    ignoredCwds: new Set(config.ignore),
    knownForks: new Set(),
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
    ignoredCwds: new Set(config.ignore),
    knownForks: new Set(),
    previousCaptureToday:
      previousHandoff === null
        ? null
        : { signature: buildEvidenceSignature(previousHandoff.facts) },
    currentSignature: buildEvidenceSignature(currentFacts),
  };
  return evaluateEligibility(session, criteria);
}
