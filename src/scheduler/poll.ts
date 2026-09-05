/**
 * One daemon poll cycle (docs/ESPECIFICACAO.md § "Comportamento do daemon": "loop de verificação a
 * cada 30 s"). `scheduler/loop.ts` calls this repeatedly, sleeping between calls via `Clock.sleep`
 * (D-019) — this file has no timer of its own, and no memory of its own either: every poll re-reads
 * `Config`/`DayState` from `Storage` (D-006: `estado.json` is "persistido, não guardado em
 * memória", so a concurrent `seeya snooze`/`skip-today` is visible on the very next poll).
 *
 * **The active-turn retry (docs/ESPECIFICACAO.md: up to 5 minutes) falls out of the SAME 30s poll
 * loop, not a second one.** `core/schedule.ts#decideSchedule`'s own contract is explicit that its
 * `nextState` is only a proposal — "the caller only carries this forward after acting on decision
 * succeeds". This file takes that literally for `endOfDay`: while any just-captured session is
 * still `capturedDuringActiveTurn`, it persists everything EXCEPT `endOfDayFired`, so the very next
 * 30s poll sees the SAME undecided day, asks `decideSchedule` again, and gets `endOfDay` again —
 * `application/endDay` naturally skips anything already captured cleanly (D-026's anti-duplication)
 * and only really re-attempts what's still active. `Spike J` is why this doesn't need a tighter
 * loop of its own: the daemon-relevant cache tier is ~1h, so 30s-grained polling was already the
 * chosen cadence for the whole design, not a workaround invented here.
 */
import { decideSchedule, emptyDayState } from '../core/schedule.js';
import { localDayString } from '../core/day.js';
import { recordCaptureAttempts } from '../core/capture-retry.js';
import type { DayState } from '../core/types.js';
import type { EndDayDeps, EndDayResult } from '../application/types.js';
import { endDay } from '../application/end-day.js';
import type { DaemonDeps } from './types.js';
import { buildRetryFilter, nonModelSessionIds } from './capture-filter.js';
import {
  buildDaemonEndOfDayNotice,
  buildEarlyWarningNotice,
  buildLeadTimeNotice,
} from './notices.js';

/**
 * Total budget for the active-turn retry (docs/ESPECIFICACAO.md's own number: "adia a captura...
 * por até 5 minutos, tentando de novo. Esgotado o prazo, captura assim mesmo"). Compared against
 * `ScheduleDecision`'s own `delayMs` for the `endOfDay` case — `now - effectiveEndOfDay` — which is
 * exactly "how long past the deadline are we", the same quantity this budget bounds.
 */
const ACTIVE_TURN_RETRY_BUDGET_MS = 5 * 60_000;

function buildEndDayDeps(deps: DaemonDeps, relevanceHours: number): EndDayDeps {
  return {
    sessionProvider: deps.buildSessionProvider(relevanceHours),
    transcriptReader: deps.transcriptReader,
    gitReader: deps.gitReader,
    leanGenerator: deps.leanGenerator,
    deepGenerator: deps.deepGenerator,
    storage: deps.storage,
    processControl: deps.processControl,
    clock: deps.clock,
    forkCleanup: deps.forkCleanup,
  };
}

/**
 * Runs one `endOfDay` decision through `application/endDay`, then decides — from THIS call's own
 * result — whether today's closure is truly finished or needs another poll's worth of retry.
 *
 * **Calling `endDay` again during the retry window re-runs fork cleanup and rewrites
 * `summary.md` every time — accepted, not overlooked.** Both are idempotent, I/O-only (no model
 * calls, no money), so repeating them up to ~10 times across a 5-minute window costs a little disk
 * activity, never a repeat of the ONE expense this file actually guards
 * (`core/capture-retry.ts`'s own docstring): a `claude -p` call.
 */
async function runEndOfDay(
  deps: DaemonDeps,
  priorState: DayState,
  decision: { readonly delayMs: number },
  nextStateFromDecision: DayState,
  config: { readonly relevanceHours: number },
): Promise<EndDayResult> {
  const endDayDeps = buildEndDayDeps(deps, config.relevanceHours);
  const sessionFilter = buildRetryFilter(priorState);
  const result = await endDay(endDayDeps, sessionFilter ? { sessionFilter } : {});

  const withAttempts = recordCaptureAttempts(priorState, nonModelSessionIds(result));
  const stillActiveTurn = result.captured.some((c) => c.handoff.capturedDuringActiveTurn);
  const budgetExpired = decision.delayMs >= ACTIVE_TURN_RETRY_BUDGET_MS;
  const finalize = !stillActiveTurn || budgetExpired;

  if (!finalize) {
    // endOfDayFired stays false (withAttempts is built from `priorState`, never
    // `nextStateFromDecision`) — the next 30s poll asks decideSchedule the same undecided
    // question again.
    await deps.storage.saveState(withAttempts);
    return result;
  }

  await deps.storage.saveState({
    ...nextStateFromDecision,
    captureAttemptsToday: withAttempts.captureAttemptsToday,
  });
  await deps.notifier.notify(
    buildDaemonEndOfDayNotice(result, decision.delayMs, nextStateFromDecision.day),
  );
  return result;
}

/** One full poll: early warnings, then the schedule decision, then whatever that decision calls
 * for. Never throws — `scheduler/loop.ts` wraps this anyway (belt and suspenders, docs/PLANO-DE-ENTREGA.md
 * S4-T3: "o perigo que só existe em laço" — one bad poll must never end the daemon). */
export async function pollOnce(deps: DaemonDeps): Promise<void> {
  const config = await deps.storage.readConfig();
  const sessionProvider = deps.buildSessionProvider(config.relevanceHours);
  const discovery = await sessionProvider.list();

  // D-018/Q-024: runs every poll, independent of the schedule decision below — discovery and
  // early-warning detection don't care whether today's closure is disabled, skipped, or hours
  // away. `discoverEarlyWarnings` already persists the "already warned" bookkeeping itself and
  // returns only what's NEW, so there is nothing else to deduplicate here — one `Notice` per
  // warning (`buildEarlyWarningNotice`), never batched.
  const warnings = await deps.discoverEarlyWarnings(discovery.sessions);
  for (const warning of warnings) {
    await deps.notifier.notify(buildEarlyWarningNotice(warning));
  }

  const now = deps.clock.now();
  const persisted = (await deps.storage.readState()) ?? emptyDayState(localDayString(now));
  const { decision, nextState } = decideSchedule(config, persisted, now);

  if (decision.kind === 'leadTimeWarning') {
    await deps.notifier.notify(buildLeadTimeNotice(decision.leadTimeMinutes, nextState.day));
    await deps.storage.saveState(nextState);
    return;
  }
  if (decision.kind === 'endOfDay') {
    await runEndOfDay(deps, persisted, decision, nextState, config);
    return;
  }
  // disabled / skipped / alreadyEnded / waiting: nothing to persist. `decideSchedule`'s own
  // `resetIfNewDay` recomputes the midnight reset from `persisted` on every call regardless of
  // whether it was ever written back, so skipping the write here is safe AND is what keeps a
  // quiet day from writing `estado.json` every 30s for nothing (docs/PLANO-DE-ENTREGA.md S4-T3:
  // "nada disso pode virar... enxurrada... de gasto" — applied to needless disk writes, not just
  // money, on the same "don't do in a loop what's only tolerable once" principle).
}
