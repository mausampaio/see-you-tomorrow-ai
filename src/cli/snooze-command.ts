/**
 * `seeya snooze [+15m|+30m|+1h]` and `seeya skip-today` (docs/ESPECIFICACAO.md § "seeya snooze...",
 * D-006). Both only mutate the persisted `DayState` — no daemon has to be running for either to
 * take effect (`core/ports.ts#Storage.saveState`'s own docstring): whatever poll runs next, from a
 * daemon already running or the next `seeya daemon` start, reads whatever this command just wrote
 * from `~/.seeya/estado.json` (`scheduler/poll.ts` re-reads `readState()` at the top of every
 * cycle, never keeping an in-memory copy across polls, precisely so this is true).
 *
 * `core/schedule.ts` already owns every actual mutation rule (`applySnooze`/`applySkipToday`,
 * `resetIfNewDay`'s midnight reset, D-006's "não há limite de adiamentos") — this module only
 * resolves `today` from the injected `Clock` (D-019: never `new Date()` here), reads/writes
 * `Storage`, and renders the result as plain text (AGENTS.md § "Registro e saída").
 */
import { localDayString } from '../core/day.js';
import {
  applySkipToday,
  applySnooze,
  decideSchedule,
  emptyDayState,
  type ScheduleDecision,
} from '../core/schedule.js';
import type { Clock, Storage } from '../core/ports.js';
import type { Config } from '../core/types.js';

export interface SnoozeCommandContext {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly config: Config;
}

/**
 * D-006's three named increments. The CLI is what enforces this exact set —
 * `core/schedule.ts#applySnooze`'s own docstring is explicit that the core function itself accepts
 * any positive number of minutes on purpose, leaving "which increments a UI exposes" to the
 * caller. Keys match `scheduler/notices.ts#buildLeadTimeNotice`'s own wording ("Run \"seeya snooze
 * +15m\" (or +30m/+1h)...") exactly, so the notice a person reads and the command they type never
 * drift apart.
 */
const SNOOZE_INCREMENTS: Readonly<Record<string, number>> = {
  '+15m': 15,
  '+30m': 30,
  '+1h': 60,
};

/** `null` on anything not in `SNOOZE_INCREMENTS` — exported so `tests/unit/cli/snooze-command.test.ts`
 * can cover the parser's own boundary directly, not only through `runSnoozeCommand`'s full flow. */
export function parseSnoozeIncrement(raw: string): number | null {
  return SNOOZE_INCREMENTS[raw] ?? null;
}

function formatLocalTime(instant: Date): string {
  const pad2 = (value: number): string => String(value).padStart(2, '0');
  return `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}`;
}

/**
 * Renders what just happened using `decideSchedule`'s OWN read of the result — never a second,
 * hand-rolled interpretation of `skipped`/`endOfDayFired` here, so this message can never disagree
 * with what the next real poll will actually do with the same state.
 */
function renderSnoozeConfirmation(
  minutesAdded: number,
  totalMinutes: number,
  decision: ScheduleDecision,
): string {
  const header = `Snoozed by ${minutesAdded} minutes (${totalMinutes} minutes total today).`;
  switch (decision.kind) {
    case 'disabled':
      return (
        `${header} End-of-day is not configured (endOfDayTime is unset) — this has no effect ` +
        'until you set one ("seeya config set endOfDayTime <HH:MM>").'
      );
    case 'skipped':
      return (
        `${header} Today is already skipped ("seeya skip-today") — recorded, but it has no ` +
        'effect unless you run "seeya end-day" by hand today.'
      );
    case 'alreadyEnded':
      return `${header} Today's end-of-day closure already ran — there is nothing left to delay.`;
    case 'endOfDay':
      return (
        `${header} The new effective end-of-day (${formatLocalTime(decision.effectiveEndOfDay)}) ` +
        'has already passed — closure is due now.'
      );
    case 'leadTimeWarning':
    case 'waiting':
      return `${header} New effective end-of-day: ${formatLocalTime(decision.effectiveEndOfDay)}.`;
  }
}

export async function runSnoozeCommand(
  context: SnoozeCommandContext,
  rawIncrement: string,
): Promise<string> {
  const minutes = parseSnoozeIncrement(rawIncrement);
  if (minutes === null) {
    const expected = Object.keys(SNOOZE_INCREMENTS).join('|');
    return `seeya snooze: invalid increment "${rawIncrement}"; expected one of ${expected}.`;
  }
  const now = context.clock.now();
  const today = localDayString(now);
  const stored = (await context.storage.readState()) ?? emptyDayState(today);
  const next = applySnooze(stored, today, minutes);
  await context.storage.saveState(next);
  const { decision } = decideSchedule(context.config, next, now);
  return renderSnoozeConfirmation(minutes, next.snoozeMinutesTotal, decision);
}

export async function runSkipTodayCommand(context: SnoozeCommandContext): Promise<string> {
  const now = context.clock.now();
  const today = localDayString(now);
  const stored = (await context.storage.readState()) ?? emptyDayState(today);
  const next = applySkipToday(stored, today);
  await context.storage.saveState(next);
  if (context.config.endOfDayTime === null) {
    return (
      'Today is marked as skipped. End-of-day is not configured (endOfDayTime is unset), so ' +
      'this has no additional effect right now.'
    );
  }
  return "Today's automatic end-of-day closure is skipped. It resumes tomorrow.";
}
