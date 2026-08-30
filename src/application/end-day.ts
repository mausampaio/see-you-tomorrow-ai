/**
 * `endDay`'s top-level orchestration (docs/ESPECIFICACAO.md § `seeya end-day`, steps 1-4; step 5 —
 * notifying the result — is S4-T1). Discovers sessions, filters by the five eligibility conditions
 * (docs/ESPECIFICACAO.md § "Elegibilidade"), captures each eligible one under a concurrency limit
 * (`config.captureConcurrency`) with per-session failure isolation, writes the day's consolidated
 * briefing (S2-T4, `application/briefing.ts`), runs D-012's fork cleanup (S2-T6, wired in by
 * S2-T5 — see the reasoning on `EndDayDeps.forkCleanup`), and — for sessions that opted in —
 * terminates the process only after its handoff is verified on disk (D-002).
 *
 * **`--dry-run` and `--session` (S2-T5, `EndDayOptions`) run through this SAME pipeline, not a
 * parallel one.** `sessionFilter` only narrows which discovered sessions reach
 * `mapWithConcurrencyLimit` below; `dryRun` is threaded down to `captureSession` and to this
 * function's own briefing/fork-cleanup steps, each of which stops right before its own write
 * (`capture-session.ts#persistAndMaybeTerminate`, `previewDailyBriefing` below, and the fork-cleanup
 * skip) — everything upstream of a write (discovery, eligibility, evidence gathering, generation)
 * runs for real either way, so a dry-run preview can never describe a different code path than the
 * one a real run actually takes.
 */
import { previewDailyBriefing, writeDailyBriefing } from './briefing.js';
import { localDayString } from '../core/day.js';
import type { Config, Day, DiscoveredSession } from '../core/types.js';
import type { ForkCleanupResult } from '../core/ports.js';
import { captureSession } from './capture-session.js';
import { mapWithConcurrencyLimit } from './concurrency.js';
import { evaluateCheapEligibility } from './eligibility-assembly.js';
import type {
  CaptureFailure,
  CapturedSession,
  EndDayDeps,
  EndDayOptions,
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
  dryRun: boolean,
): Promise<SessionOutcome> {
  const cheap = evaluateCheapEligibility(session, now, config);
  if (!cheap.eligible) {
    return { kind: 'ineligible', session, reasons: cheap.reasons };
  }
  try {
    const outcome = await captureSession({ deps, session, config, now, day, dryRun });
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

interface ForkCleanupOutcomeSummary {
  readonly forkCleanup: ForkCleanupResult | null;
  readonly forkCleanupError: string | null;
}

/**
 * D-012's daily cleanup, isolated the same way a single session's capture failure is: a rejection
 * here becomes a named field on `EndDayResult`, never an exception that would take down captures
 * and the briefing that already succeeded earlier in this same run.
 *
 * `dryRun` skips the call entirely rather than previewing it — deleting a stale fork's file is
 * itself the kind of write `--dry-run` exists to never perform, and `ForkCleanup.cleanup()` has no
 * read-only "plan" variant today (only the pure `core/fork-cleanup.ts#planForkCleanup` does, and
 * it isn't reachable from here without also duplicating `DiscoveryForkCleanup`'s own
 * `forks.json`-reading step). See docs/QUESTOES.md for this gap flagged for the PO.
 */
async function runForkCleanup(
  deps: EndDayDeps,
  config: Config,
  dryRun: boolean,
): Promise<ForkCleanupOutcomeSummary> {
  if (dryRun) {
    return { forkCleanup: null, forkCleanupError: null };
  }
  try {
    const forkCleanup = await deps.forkCleanup.cleanup(config.forkCleanupDays);
    return { forkCleanup, forkCleanupError: null };
  } catch (error) {
    const forkCleanupError = error instanceof Error ? error.message : String(error);
    return { forkCleanup: null, forkCleanupError };
  }
}

/**
 * Runs the whole end-of-day encerramento: read config, discover sessions, capture every eligible
 * one (bounded concurrency, per-session isolation), write the day's consolidated briefing, run
 * D-012's fork cleanup, and report every outcome — captured, ineligible, failed, and Q-007's
 * termination notices — never silently dropping a bucket.
 *
 * `options.sessionFilter` (S2-T5, `--session`) narrows which discovered sessions are processed;
 * `options.dryRun` (S2-T5, `--dry-run`) runs the identical pipeline for every session but stops
 * before any write or termination — see this file's own top comment for why both flags reuse this
 * one function instead of a separate preview path.
 *
 * @example
 * const result = await endDay(deps);
 * // result.captured.length handoffs written, and ~/.seeya/days/<day>/summary.md consolidates
 * // all of them; result.terminationNotices names any canTerminate: true session that stayed
 * // alive despite a graceful attempt (Q-007).
 *
 * @example
 * const preview = await endDay(deps, { dryRun: true });
 * // preview.briefingPreview holds the markdown that WOULD have been written; nothing was.
 */
export async function endDay(deps: EndDayDeps, options: EndDayOptions = {}): Promise<EndDayResult> {
  const config = await deps.storage.readConfig();
  const discovery = await deps.sessionProvider.list();
  const now = deps.clock.now();
  const day = localDayString(now);
  const dryRun = options.dryRun ?? false;
  const sessionsInScope = options.sessionFilter
    ? discovery.sessions.filter(options.sessionFilter)
    : discovery.sessions;

  const outcomes = await mapWithConcurrencyLimit(
    sessionsInScope,
    config.captureConcurrency,
    (session) => runSession(deps, session, config, now, day, dryRun),
  );
  const { ineligible, captured, failedCaptures, terminationNotices } = aggregate(outcomes);

  const briefingPreview = dryRun
    ? await previewDailyBriefing(
        deps.storage,
        day,
        now,
        captured.map((session) => session.handoff),
      )
    : null;
  if (!dryRun) {
    await writeDailyBriefing(deps.storage, day, now);
  }
  const { forkCleanup, forkCleanupError } = await runForkCleanup(deps, config, dryRun);

  return {
    day,
    discoveredCount: discovery.sessions.length,
    rejectedDiscoveries: discovery.rejected,
    ineligible,
    captured,
    failedCaptures,
    terminationNotices,
    dryRun,
    briefingPreview,
    sessionsInScope: sessionsInScope.length,
    forkCleanup,
    forkCleanupError,
  };
}
