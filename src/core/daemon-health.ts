/**
 * S4-T3b's pure decision, Part 1: does one poll's outcome change `DayState.daemonHealth`
 * (`core/types.ts`), and does crossing the "acionável" threshold deserve exactly one notification?
 * No I/O here — `scheduler/health.ts` reads/writes `Storage`/`Notifier` around these functions,
 * called from `scheduler/loop.ts`'s own `catch` around `pollOnce` (docs/PLANO-DE-ENTREGA.md S4-T3b).
 *
 * Same "avisa uma vez, não repete" shape D-018 already established for early warnings, applied here
 * to a different trigger: a daemon that keeps failing, not a session that's missing a transcript.
 */
import type { DaemonHealth } from './types.js';

/** The bookkeeping a machine that has never failed a poll starts from (D-025: no failure yet is
 * not an error). Also what a successful poll resets back to. */
export const EMPTY_DAEMON_HEALTH: DaemonHealth = {
  lastCycleError: null,
  consecutiveCycleFailures: 0,
};

/**
 * How many consecutive failed 30s polls (docs/ESPECIFICACAO.md's own cadence,
 * `scheduler/loop.ts#POLL_INTERVAL_MS`) before the daemon's own silence becomes a single
 * notification (docs/PLANO-DE-ENTREGA.md S4-T3b: "uma notificação, uma só").
 *
 * **Chosen conservatively; the spec gives no number to work from** (S4-T3b's own text: "se não
 * houver base, escolha o mais conservador"). 120 cycles = 1 hour at the 30s cadence — reusing the
 * order of magnitude this project already established as its own scale for "how long is
 * significant" (docs/PLANO-DE-ENTREGA.md S4-T3's update, item 4: Spike J's prompt-cache tier lives
 * "na faixa de uma hora"), instead of inventing a third arbitrary number. Long enough that a single
 * transient blip (one dropped connection, one slow git call) never crosses it; short enough that on
 * any machine actually left running through a workday, the person still finds out well before the
 * next day — the exact failure mode this task exists to close (docs/PLANO-DE-ENTREGA.md S4-T3b: "a
 * pessoa descobre no dia seguinte... e não há o que investigar").
 */
export const NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES = 120;

export interface CycleFailureOutcome {
  readonly health: DaemonHealth;
  /**
   * `true` on exactly the ONE poll that crosses the threshold — never on every poll past it
   * (docs/PLANO-DE-ENTREGA.md S4-T3b: "notificar por ciclo é a enxurrada que o brief da S4-T3
   * proibiu"). `consecutiveCycleFailures` only ever advances by 1 per call and only this function
   * ever advances it, so `===` catches the crossing exactly once, with no second persisted
   * "already notified" flag needed — the counter itself IS the memory, the same economy
   * `core/schedule.ts#findDueLeadTime`'s `firedLeadTimesInMinutes` list uses for a different
   * trigger.
   */
  readonly shouldNotify: boolean;
}

/**
 * One failed poll. `message` is the caller's own rendering of whatever the poll threw
 * (`scheduler/health.ts`) — this function only stores it, never interprets it or classifies it.
 *
 * @example
 * const { health, shouldNotify } = recordCycleFailure(current, 'ECONNREFUSED', clock.now());
 * await storage.saveState({ ...state, daemonHealth: health });
 * if (shouldNotify) await notifier.notify(buildDaemonUnhealthyNotice(health));
 */
export function recordCycleFailure(
  current: DaemonHealth,
  message: string,
  now: Date,
): CycleFailureOutcome {
  const consecutiveCycleFailures = current.consecutiveCycleFailures + 1;
  return {
    health: { lastCycleError: { message, at: now }, consecutiveCycleFailures },
    shouldNotify: consecutiveCycleFailures === NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES,
  };
}

/**
 * One poll that completed without throwing. Returns `current` **unchanged (same reference)** when
 * there was nothing to clear, so the caller (`scheduler/health.ts`) can skip a write on the
 * overwhelmingly common "already healthy" poll — same "don't write estado.json every 30s for
 * nothing" principle `scheduler/poll.ts`'s own quiet branches already follow.
 */
export function recordCycleSuccess(current: DaemonHealth): DaemonHealth {
  if (current.consecutiveCycleFailures === 0 && current.lastCycleError === null) {
    return current;
  }
  return EMPTY_DAEMON_HEALTH;
}
