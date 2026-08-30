/**
 * `endDay`'s top-level orchestration (docs/ESPECIFICACAO.md § `seeya end-day`, steps 1-2 and 4;
 * step 3 — the consolidated briefing — is S2-T4, and step 5 — notifying the result — is S4-T1).
 * Discovers sessions, filters by the five eligibility conditions (docs/ESPECIFICACAO.md §
 * "Elegibilidade"), captures each eligible one under a concurrency limit
 * (`config.captureConcurrency`) with per-session failure isolation, and — for sessions that opted
 * in — terminates the process only after its handoff is verified on disk (D-002).
 *
 * `--dry-run` and `--session` (docs/ESPECIFICACAO.md's flags) are S2-T5's concern: this function
 * always discovers everything and always writes/terminates for real. `cli/` decides what to do
 * with that — filtering which sessions to pass in, or not calling `endDay` at all for a pure
 * dry-run preview — without this use case needing to know about either flag.
 */
import { localDayString } from '../core/day.js';
import type { Config, Day, DiscoveredSession } from '../core/types.js';
import { captureSession } from './capture-session.js';
import { mapWithConcurrencyLimit } from './concurrency.js';
import { evaluateCheapEligibility } from './eligibility-assembly.js';
import type {
  CaptureFailure,
  CapturedSession,
  EndDayDeps,
  EndDayResult,
  IneligibleSession,
  TerminationNotice,
} from './types.js';
import type { IneligibilityReason } from '../core/eligibility.js';

type SessionOutcome =
  | {
      readonly kind: 'ineligible';
      readonly session: DiscoveredSession;
      readonly reasons: readonly IneligibilityReason[];
    }
  | {
      readonly kind: 'captured';
      readonly captured: CapturedSession;
      readonly notice: TerminationNotice | null;
    }
  | { readonly kind: 'failed'; readonly session: DiscoveredSession; readonly reason: string };

/**
 * One session's whole journey: the cheap eligibility stage (no I/O), then — only if it passes —
 * the full capture pipeline (`capture-session.ts`), wrapped in its own `try`/`catch` so an
 * unexpected failure here becomes this session's own `SessionOutcome` instead of rejecting the
 * `Promise.all` `mapWithConcurrencyLimit` runs underneath (docs/PLANO-DE-ENTREGA.md S2-T3:
 * "isolamento de falha por sessão").
 */
async function runSession(
  deps: EndDayDeps,
  session: DiscoveredSession,
  config: Config,
  now: Date,
  day: Day,
): Promise<SessionOutcome> {
  const cheap = evaluateCheapEligibility(session, now, config);
  if (!cheap.eligible) {
    return { kind: 'ineligible', session, reasons: cheap.reasons };
  }
  try {
    const outcome = await captureSession({ deps, session, config, now, day });
    if (outcome.kind === 'ineligible') {
      return { kind: 'ineligible', session, reasons: outcome.reasons };
    }
    return {
      kind: 'captured',
      captured: { handoff: outcome.handoff, terminated: outcome.terminated },
      notice: outcome.terminationNotice,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: 'failed', session, reason };
  }
}

function toIneligibleSession(
  session: DiscoveredSession,
  reasons: readonly IneligibilityReason[],
): IneligibleSession {
  return { sessionId: session.sessionId, cwd: session.cwd, name: session.name, reasons };
}

function toCaptureFailure(session: DiscoveredSession, reason: string): CaptureFailure {
  return { sessionId: session.sessionId, cwd: session.cwd, name: session.name, reason };
}

interface AggregatedOutcomes {
  readonly ineligible: IneligibleSession[];
  readonly captured: CapturedSession[];
  readonly failedCaptures: CaptureFailure[];
  readonly terminationNotices: TerminationNotice[];
}

function emptyAggregation(): AggregatedOutcomes {
  return { ineligible: [], captured: [], failedCaptures: [], terminationNotices: [] };
}

/** D-022's "aceitos e rejeitados" shape, extended to every bucket `EndDayResult` reports
 * (`types.ts`) — nothing here decides anything, it only sorts already-decided outcomes. */
function aggregate(outcomes: readonly SessionOutcome[]): AggregatedOutcomes {
  const result = emptyAggregation();
  for (const outcome of outcomes) {
    if (outcome.kind === 'ineligible') {
      result.ineligible.push(toIneligibleSession(outcome.session, outcome.reasons));
    } else if (outcome.kind === 'captured') {
      result.captured.push(outcome.captured);
      if (outcome.notice !== null) {
        result.terminationNotices.push(outcome.notice);
      }
    } else {
      result.failedCaptures.push(toCaptureFailure(outcome.session, outcome.reason));
    }
  }
  return result;
}

/**
 * Runs the whole end-of-day encerramento: read config, discover sessions, capture every eligible
 * one (bounded concurrency, per-session isolation), and report every outcome — captured,
 * ineligible, failed, and Q-007's termination notices — never silently dropping a bucket.
 *
 * @example
 * const result = await endDay(deps);
 * // result.captured.length handoffs written; result.terminationNotices names any
 * // canTerminate: true session that stayed alive despite a graceful attempt (Q-007).
 */
export async function endDay(deps: EndDayDeps): Promise<EndDayResult> {
  const config = await deps.storage.readConfig();
  const discovery = await deps.sessionProvider.list();
  const now = deps.clock.now();
  const day = localDayString(now);

  const outcomes = await mapWithConcurrencyLimit(
    discovery.sessions,
    config.captureConcurrency,
    (session) => runSession(deps, session, config, now, day),
  );
  const { ineligible, captured, failedCaptures, terminationNotices } = aggregate(outcomes);

  return {
    day,
    discoveredCount: discovery.sessions.length,
    rejectedDiscoveries: discovery.rejected,
    ineligible,
    captured,
    failedCaptures,
    terminationNotices,
  };
}
