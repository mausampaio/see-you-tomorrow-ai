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
 */
export function buildLeadTimeNotice(leadTimeMinutes: number, day: string): Notice {
  return {
    title: `seeya: closing in ${leadTimeMinutes} min`,
    body:
      `Today's (${day}) end-of-day capture runs in about ${leadTimeMinutes} minutes. ` +
      'Run "seeya snooze +15m" (or +30m/+1h) to push it back, or "seeya skip-today" to skip it.',
  };
}

/**
 * How long past the effective deadline still reads as "on time" — `core/schedule.ts#ScheduleDecision`'s
 * own docstring frames the real gap this sits inside: "a normal on-time trigger has `delayMs` on
 * the order of one poll interval (≤30s); a machine waking from suspension hours later has `delayMs`
 * in the hours." Any threshold between those two extremes draws the same line; **5 minutes** is
 * chosen to match the daemon's own active-turn retry window (`scheduler/poll.ts`, docs/ESPECIFICACAO.md:
 * "adia a captura... por até 5 minutos") rather than adding a third, unrelated number to the
 * codebase — a run that needed the full retry window to let every mid-turn session finish also
 * crosses this threshold, and that overlap is accepted on purpose: taking the full grace period to
 * close is itself worth a heads-up, even when the cause was an active turn rather than a suspended
 * machine. Neither `core/schedule.ts` nor `application/endDay` picks this number — S4-T3's own brief
 * is explicit that `delayMs` is raw specifically so the caller decides, and this is that decision.
 */
const DELAY_WARNING_THRESHOLD_MS = 5 * 60_000;

function failedCaptureSummary(result: EndDayResult): string | null {
  if (result.failedCaptures.length === 0) {
    return null;
  }
  return `${pluralize(result.failedCaptures.length, 'capture', 'captures')} failed.`;
}

/**
 * The daemon's own end-of-day notice — distinguishable from an on-time close whenever `delayMs`
 * crosses `DELAY_WARNING_THRESHOLD_MS` (docs/ESPECIFICACAO.md: "aviso de que houve atraso" after the
 * machine was suspended through the scheduled time). `null` is never returned here the way
 * `cli/end-day-notice.ts#buildEndDayNotice` can for a dry run — the daemon never runs `--dry-run`.
 */
export function buildDaemonEndOfDayNotice(
  result: EndDayResult,
  delayMs: number,
  day: string,
): Notice {
  const delayed = delayMs >= DELAY_WARNING_THRESHOLD_MS;
  const title = delayed ? `seeya end-day: ${day} (delayed)` : `seeya end-day: ${day}`;
  const lines = [`${pluralize(result.captured.length, 'session', 'sessions')} captured.`];
  if (delayed) {
    const delayMinutes = Math.round(delayMs / 60_000);
    lines.push(
      `The machine was likely asleep past the scheduled time — this ran about ` +
        `${delayMinutes} minute${delayMinutes === 1 ? '' : 's'} late, on waking.`,
    );
  }
  const failedSummary = failedCaptureSummary(result);
  if (failedSummary !== null) {
    lines.push(failedSummary);
  }
  return { title, body: lines.join(' ') };
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
