/**
 * Builds every `Notice` (`core/ports.ts`) the daemon shows outside the terminal. English (D-028):
 * notification text is public. Concentrated here, not scattered (AGENTS.md § "Texto voltado ao
 * usuário") — same convention `cli/end-day-notice.ts` already established for `seeya end-day`'s own
 * result notice.
 *
 * **A small, deliberate duplication of `cli/end-day-notice.ts#buildEndDayNotice`, not a shared
 * import.** `scheduler/` cannot import `cli/` at all (docs/ARQUITETURA.md's layer matrix: `cli/` is
 * the composition root, never a dependency of anything below it) — moving that S4-T1 module into
 * `application/` so both sides could share it would relayer an already-approved file for a handful
 * of lines. `buildDaemonEndOfDayNotice` below also needs to say something `buildEndDayNotice` never
 * has a reason to (whether the closure was delayed, S4-T3's own item 5), so the two were never going
 * to stay byte-identical anyway.
 */
import type { EndDayResult } from '../application/types.js';
import type { EarlyWarning } from '../core/early-warnings.js';
import type { DaemonHealth } from '../core/types.js';
import type { Notice } from '../core/ports.js';

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * docs/ESPECIFICACAO.md § "Comportamento do daemon": "dispara notificação prévia com as ações
 * disponíveis" — S4-T1's contract cut action buttons (Spike B), so this names the equivalent
 * command in `body` instead, the same substitute every other notice in this project already uses.
 *
 * **`minutesRemaining` is the actual gap to `effectiveEndOfDay`, not the configured lead time that
 * fired (S4-T6, D-025).** This function used to take the CONFIGURED lead time itself
 * (`leadTimeMinutes`, e.g. `30`) and print it back verbatim — that is the name of the rule that
 * triggered, not a fact about how much time is left, and the two only agree when the poll lands
 * inside the same 30s window the threshold was crossed in. `scheduler/poll.ts` computes this with
 * `core/schedule.ts#minutesRemaining(decision.effectiveEndOfDay, now)` — `now` from the injected
 * `Clock` (D-019), never read in here. Whether the warning fires at all is unchanged: that's still
 * `core/schedule.ts#decideSchedule`'s call, and `firedLeadTimesInMinutes` still records the
 * CONFIGURED lead time, exactly as before — only what this one sentence says about the wait changed.
 */
export function buildLeadTimeNotice(minutesRemaining: number, day: string): Notice {
  const unit = minutesRemaining === 1 ? 'minute' : 'minutes';
  return {
    title: `seeya: closing in ${minutesRemaining} min`,
    body:
      `Today's (${day}) end-of-day capture runs in about ${minutesRemaining} ${unit}. ` +
      'Run "seeya snooze +15m" (or +30m/+1h) to push it back, or "seeya skip-today" to skip it.',
  };
}

function failedCaptureSummary(result: EndDayResult): string | null {
  if (result.failedCaptures.length === 0) {
    return null;
  }
  return `${pluralize(result.failedCaptures.length, 'capture', 'captures')} failed.`;
}

/**
 * The daemon's own end-of-day notice. `overdue` (D-036, `Config.overdueFireThresholdMinutes` —
 * `scheduler/poll.ts` is what compares `delayMs` against it; this function only renders the
 * already-made decision, never the threshold itself) distinguishes an on-time close from one that
 * ran late enough that termination was skipped for every session this run, `canTerminate: true`
 * included. `null` is never returned here the way `cli/end-day-notice.ts#buildEndDayNotice` can for
 * a dry run — the daemon never runs `--dry-run`.
 */
export function buildDaemonEndOfDayNotice(
  result: EndDayResult,
  delayMs: number,
  day: string,
  overdue: boolean,
): Notice {
  const title = overdue ? `seeya end-day: ${day} (delayed)` : `seeya end-day: ${day}`;
  const lines = [`${pluralize(result.captured.length, 'session', 'sessions')} captured.`];
  if (overdue) {
    const delayMinutes = Math.round(delayMs / 60_000);
    lines.push(
      `This ran about ${delayMinutes} minute${delayMinutes === 1 ? '' : 's'} late (D-036) — no ` +
        'session was terminated this run, even one opted into canTerminate. Run "seeya end-day" ' +
        'by hand if any of them should close now.',
    );
  }
  const failedSummary = failedCaptureSummary(result);
  if (failedSummary !== null) {
    lines.push(failedSummary);
  }
  return { title, body: lines.join(' ') };
}

/**
 * D-036's "dia local diferente" case: the local calendar day rolled over before the daemon ever
 * got a chance to fire yesterday's `endOfDayTime` (the machine was asleep through both the deadline
 * AND midnight). The daemon refuses to fire it now — doing so would write yesterday's closure into
 * TODAY's folder, capturing this morning's fresh sessions as if they were last night's leftovers
 * (D-036: "não é atraso, é dado errado") — so this is the only trace that day's closure ever gets;
 * without it, the day would simply look like it never had one, with no record anyone could act on.
 * `scheduler/poll.ts` calls this at most once per missed day (the "avisa uma vez" pattern
 * `core/daemon-health.ts` already established for a different trigger), not on every 30s poll.
 */
export function buildMissedEndOfDayNotice(missedDay: string): Notice {
  return {
    title: `seeya: ${missedDay} never closed`,
    body:
      `The local day changed before the scheduled close for ${missedDay} could run — probably ` +
      `the machine was asleep past midnight. Nothing was captured or terminated for that day, ` +
      'and there is no way to redo it after the fact. Run "seeya sessions" to see what is still ' +
      'open, or "seeya end-day" now for an up-to-date handoff of whatever is still running.',
  };
}

/** D-018/Q-024: the daemon is the only thing that sees sessions continuously, so it's where an
 * `EarlyWarning`'s `message` finally becomes a real `Notice` — the two S1-T7 producers of these
 * warnings were built before `Notifier` existed at all. One notice per warning, not batched: each
 * already names one specific session or key file, and batching would bury that under a summary
 * line nobody asked for. */
export function buildEarlyWarningNotice(warning: EarlyWarning): Notice {
  const title =
    warning.kind === 'missingTranscript'
      ? 'seeya: session has no transcript'
      : 'seeya: found an uninspectable session';
  return { title, body: warning.message };
}

/**
 * S4-T3b's ONE notification for a daemon that has failed every poll for
 * `NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES` cycles in a row (`core/daemon-health.ts` decides WHEN
 * to call this — never on every failing poll, only the one that crosses the threshold).
 *
 * Reports elapsed time computed from the failure count and the known 30s cadence
 * (`scheduler/loop.ts#POLL_INTERVAL_MS`, hardcoded here rather than imported — same "each file
 * re-pins the same documented number" convention `poll.ts#ACTIVE_TURN_RETRY_BUDGET_MS` and this
 * file's own `DELAY_WARNING_THRESHOLD_MS` already use, to avoid a `scheduler/`-internal import
 * cycle between `loop.ts` → `health.ts` → `notices.ts` → `loop.ts`), never a hardcoded "three
 * hours" — the failure count is the only durable memory this feature keeps (D-019: `core/` has no
 * `Clock` of its own to measure real elapsed time any other way).
 */
export function buildDaemonUnhealthyNotice(health: DaemonHealth): Notice {
  const POLL_INTERVAL_MS = 30_000;
  const minutes = Math.round((health.consecutiveCycleFailures * POLL_INTERVAL_MS) / 60_000);
  const lastMessage = health.lastCycleError?.message ?? 'unknown error';
  return {
    title: 'seeya: daemon is stuck',
    body:
      `The daemon has failed every poll for about ${minutes} minute${minutes === 1 ? '' : 's'} ` +
      `and hasn't completed a cycle since. Last error: ${lastMessage}`,
  };
}
