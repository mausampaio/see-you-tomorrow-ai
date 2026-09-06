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
import { decideSchedule, emptyDayState, resetIfNewDay } from '../core/schedule.js';
import { localDayString } from '../core/day.js';
import { recordCaptureAttempts } from '../core/capture-retry.js';
import type { Config, DayState } from '../core/types.js';
import type { EndDayDeps, EndDayResult } from '../application/types.js';
import { endDay } from '../application/end-day.js';
import type { DaemonDeps } from './types.js';
import { buildRetryFilter, nonModelSessionIds } from './capture-filter.js';
import {
  buildDaemonEndOfDayNotice,
  buildEarlyWarningNotice,
  buildLeadTimeNotice,
  buildMissedEndOfDayNotice,
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

/** The three `Config` fields `runEndOfDay` needs — narrowed from the full `Config` the same way
 * this file already narrowed it to `relevanceHours` alone, before D-035 added the other two. */
type EndOfDayConfig = Pick<
  Config,
  'relevanceHours' | 'maxCaptureAttemptsPerSessionPerDay' | 'overdueFireThresholdMinutes'
>;

/**
 * Runs one `endOfDay` decision through `application/endDay`, then decides — from THIS call's own
 * result — whether today's closure is truly finished or needs another poll's worth of retry.
 *
 * **Calling `endDay` again during the retry window re-runs fork cleanup and rewrites
 * `summary.md` every time — accepted, not overlooked.** Both are idempotent, I/O-only (no model
 * calls, no money), so repeating them up to ~10 times across a 5-minute window costs a little disk
 * activity, never a repeat of the ONE expense this file actually guards
 * (`core/capture-retry.ts`'s own docstring): a `claude -p` call.
 *
 * **D-036: `overdue` forces `EndDayOptions.skipTermination`, regardless of `canTerminate`.**
 * `overdue` reuses the SAME `decision.delayMs` `buildDaemonEndOfDayNotice` already renders — it is
 * deliberately NOT recomputed from a fresh `now` at the moment of the actual capture, a few
 * milliseconds later, because `delayMs` is already "how far past the deadline was THIS decision",
 * and this run is acting on that one decision.
 *
 * **A run that finalizes only because the active-turn retry budget expired (`budgetExpired` below)
 * is also `overdue` under the DEFAULT config, and this is accepted, not overlooked** —
 * `ACTIVE_TURN_RETRY_BUDGET_MS` (5 min) and `Config.overdueFireThresholdMinutes`'s own default (5
 * min) share their value on purpose (docs/QUESTOES.md Q-049 item 5 already made this same call for
 * the notice-only version of this threshold: "o mesmo número da janela de turno ativo, de
 * propósito, não coincidência"). This file has no way to tell "genuinely woke up from suspension"
 * apart from "spent the whole retry window mid-turn" — both show up as the same growing `delayMs`
 * across consecutive 30s polls — and D-036's own reasoning ("quando em dúvida, não encerre") argues
 * for treating them the same rather than inventing a way to tell them apart. Flagged in
 * docs/QUESTOES.md Q-054 for confirmation, since it's a real, if narrow, behavior change: a session
 * that stays active right up to the end-of-day deadline no longer gets terminated on the poll that
 * finally closes it, even with `canTerminate: true`, whenever it also took the full retry budget to
 * get there.
 */
async function runEndOfDay(
  deps: DaemonDeps,
  priorState: DayState,
  decision: { readonly delayMs: number },
  nextStateFromDecision: DayState,
  config: EndOfDayConfig,
): Promise<EndDayResult> {
  const endDayDeps = buildEndDayDeps(deps, config.relevanceHours);
  const sessionFilter = buildRetryFilter(priorState, config.maxCaptureAttemptsPerSessionPerDay);
  const overdueThresholdMs = config.overdueFireThresholdMinutes * 60_000;
  const overdue = decision.delayMs >= overdueThresholdMs;
  const result = await endDay(endDayDeps, {
    ...(sessionFilter ? { sessionFilter } : {}),
    skipTermination: overdue,
  });

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
    buildDaemonEndOfDayNotice(result, decision.delayMs, nextStateFromDecision.day, overdue),
  );
  return result;
}

/**
 * D-036's "dia local diferente" case: `stored` is whatever `estado.json` held onto BEFORE
 * `core/schedule.ts#resetIfNewDay` runs against it. A missed closure is real only when there was
 * something scheduled to miss — `config.endOfDayTime !== null` — and it genuinely never happened:
 * not already fired, and not explicitly `skipped` (D-006's "pular hoje" is an intentional opt-out,
 * not a miss to report on). Uses the CURRENT `config` even though the missed day might have been
 * configured differently — the daemon has no way to know yesterday's config, and re-reading it
 * every 30s specifically to catch this narrow case would be its own new cost for a rare event.
 */
function missedYesterdayClosure(stored: DayState, config: Pick<Config, 'endOfDayTime'>): boolean {
  return config.endOfDayTime !== null && !stored.endOfDayFired && !stored.skipped;
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
  const today = localDayString(now);
  const stored = (await deps.storage.readState()) ?? emptyDayState(today);

  // D-036, case 1: the local day already rolled over past whatever `stored` remembers. Firing
  // yesterday's `endOfDayTime` now would write yesterday's closure into TODAY's folder — a fact,
  // not a threshold (docs/PLANO-DE-ENTREGA.md: "não é número escolhido, é fato") — so this never
  // reaches `decideSchedule` at all; `resetIfNewDay` below produces the exact same fresh state
  // `decideSchedule` would derive internally, just early enough that this function can also decide
  // whether to notify. Persisted immediately so the SAME missed day isn't re-detected (and
  // re-notified) on every 30s poll for the rest of today — the "avisa uma vez" pattern
  // `core/daemon-health.ts` already established, reused instead of adding a second bookkeeping
  // field for the same idea (D-036/S4-T3d brief: "reaproveite se couber").
  const dayRolledOver = stored.day !== today;
  const persisted = resetIfNewDay(stored, today);
  if (dayRolledOver) {
    if (missedYesterdayClosure(stored, config)) {
      await deps.notifier.notify(buildMissedEndOfDayNotice(stored.day));
    }
    await deps.storage.saveState(persisted);
  }

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
  // disabled / skipped / alreadyEnded / waiting: nothing left to persist beyond the day-rollover
  // write above. `decideSchedule`'s own `resetIfNewDay` recomputes the midnight reset from
  // `persisted` on every call regardless of whether it was ever written back, so skipping any
  // further write here is safe AND is what keeps a quiet day from writing `estado.json` every 30s
  // for nothing (docs/PLANO-DE-ENTREGA.md S4-T3: "nada disso pode virar... enxurrada... de gasto" —
  // applied to needless disk writes, not just money, on the same "don't do in a loop what's only
  // tolerable once" principle).
}
