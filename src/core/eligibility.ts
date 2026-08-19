/**
 * Pure eligibility rule for ending the day (docs/ESPECIFICACAO.md § "Elegibilidade"). Five
 * conditions, all "and"-ed (a session only qualifies if all five pass). None of them depend on
 * I/O here — every external datum (config, `forks.json`, today's capture signature) arrives
 * already resolved in `EligibilityCriteria`, assembled by the caller (outside the core).
 */
import type { DiscoveredSession } from './types.js';
import { sameEvidence, type EvidenceSignature } from './evidence.js';

/**
 * Why a given session is ineligible, in the same order the conditions appear in the spec.
 * `evaluateEligibility` accumulates every applicable reason, not just the first — useful for
 * `seeya sessoes` to explain exactly why, and it's what docs/TESTES.md asks for by requiring
 * "edge combinations" (more than one condition failing at the same time) to be covered.
 */
export type IneligibilityReason =
  'noEvidence' | 'noRecentActivity' | 'ownSeeyaFork' | 'ignoredCwd' | 'duplicateToday';

/**
 * What's known about a capture already made today for this session, just enough to decide
 * anti-duplication (docs/ESPECIFICACAO.md § "Elegibilidade": "doesn't have a handoff from today
 * with the evidence unchanged since then"; the comparison rule itself is D-026). Not the whole
 * `Handoff` — that type is scope for S2-T3/S2-T4, out of this task. `null` (in place of this type,
 * on `EligibilityCriteria.previousCaptureToday`) means "no handoff exists today for this
 * session".
 */
export interface PreviousCaptureToday {
  /**
   * The evidence signature (D-026) at the moment today's capture was made — compared with
   * `EligibilityCriteria.currentSignature` via `sameEvidence`. The shape of each token is decided
   * by whoever assembles the signature (outside the core); this rule only compares.
   */
  readonly signature: EvidenceSignature;
}

export interface EligibilityCriteria {
  /** The current instant, obtained from the `Clock` port by the caller — never read here (D-019). */
  readonly now: Date;
  /** `relevanceHours` from `config.json` (default 12h, docs/ARQUITETURA.md § Config). */
  readonly relevanceHours: number;
  /**
   * `cwd`s from the `ignore` list in `config.json`, already normalized by whoever assembles this
   * object — `core/` can't import `node:path` (guard rule), so path normalization
   * (upper/lowercase, trailing slash, etc.) is the responsibility of code outside the core. The
   * comparison here is exact string equality.
   */
  readonly ignoredCwds: ReadonlySet<string>;
  /** `sessionId`s registered in `~/.seeya/forks.json` (D-012, D-027). */
  readonly knownForks: ReadonlySet<string>;
  /** See `PreviousCaptureToday`. `null` when there's no handoff today for this session. */
  readonly previousCaptureToday: PreviousCaptureToday | null;
  /**
   * The evidence signature (D-026) **right now**, at the moment of this evaluation — not just
   * the transcript from `DiscoveredSession`: it covers every D-013 source available (transcript
   * when it exists, git from S2-T1 on, etc.). Assembled by the caller; compared with
   * `previousCaptureToday.signature` to decide `duplicateToday`.
   */
  readonly currentSignature: EvidenceSignature;
}

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly reasons: readonly IneligibilityReason[];
}

/**
 * Evaluates the five conditions from docs/ESPECIFICACAO.md § "Elegibilidade" for a discovered
 * session.
 *
 * The spec's first two conditions — "at least one evidence source answered" and "had activity in
 * the last `relevanceHours` ... measured by the most recent source available" — are two faces
 * of the same field, `session.lastActivity`. With no source answering, there's no way to compute
 * "the most recent source" — so `lastActivity === null` is already both things at once: zero
 * evidence **and**, as a consequence, zero provably recent activity. That's why the two
 * conditions are mutually exclusive here (never both reasons together): no evidence is reported
 * as `noEvidence`; evidence present but outside the window, as `noRecentActivity`.
 *
 * The fifth condition, anti-duplication (D-026), compares `criteria.currentSignature` with the
 * signature of today's last capture via `sameEvidence` — never `session.lastTranscriptWrite`
 * directly, because that kept any transcript-less session "duplicate" for the whole day even if
 * its git tree had changed (the exact case of the autonomous execution agent, D-013).
 */
export function evaluateEligibility(
  session: DiscoveredSession,
  criteria: EligibilityCriteria,
): EligibilityResult {
  const reasons: IneligibilityReason[] = [];

  if (session.lastActivity === null) {
    reasons.push('noEvidence');
  } else {
    const hoursSinceLastActivity =
      (criteria.now.getTime() - session.lastActivity.getTime()) / 3_600_000;
    if (hoursSinceLastActivity > criteria.relevanceHours) {
      reasons.push('noRecentActivity');
    }
  }

  // Between S1-T10 and S1-T11 (D-023/D-029) a third shape had no sessionId at all, and this check
  // needed `session.hasSessionId &&` in front of it to compile. D-029 removed that shape;
  // `sessionId` is common to both remaining shapes again (core/types.ts), so it's readable here
  // with no narrowing.
  if (criteria.knownForks.has(session.sessionId)) {
    reasons.push('ownSeeyaFork');
  }

  if (criteria.ignoredCwds.has(session.cwd)) {
    reasons.push('ignoredCwd');
  }

  if (
    criteria.previousCaptureToday !== null &&
    sameEvidence(criteria.previousCaptureToday.signature, criteria.currentSignature)
  ) {
    reasons.push('duplicateToday');
  }

  return { eligible: reasons.length === 0, reasons };
}
