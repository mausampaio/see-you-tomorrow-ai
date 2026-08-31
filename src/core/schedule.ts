/**
 * S4-T2's pure scheduling rule (docs/ESPECIFICACAO.md § "Comportamento do daemon"): given
 * `Config`, today's `DayState` and the current instant, what should happen right now? No I/O, no
 * `new Date()`/`Date.now()` (D-019) — `now` always arrives as a parameter, resolved by whoever
 * calls this from the `Clock` port (the daemon, S4-T3).
 *
 * **Why a discriminated union, not a boolean (D-024).** "Nothing to do" has at least four
 * different causes here (disabled, skipped, already ended today, still early) and "something to
 * do" has two (a specific lead-time warning, or the end-of-day closure — possibly late). A
 * `{ fire: boolean }` — or even `{ fire: boolean; late: boolean }` — would force every caller to
 * re-derive which of those it actually got by inspecting other fields, and would make at least one
 * wrong state representable (e.g. `{ fire: false, late: true }`, which means nothing). See
 * `ScheduleDecision` below for the full list of cases and `docs/QUESTOES.md` Q-037 for the design
 * choices this file makes that aren't literal in the spec.
 *
 * **This module has no memory** — every function here is a pure `(inputs) => output`. The "don't
 * repeat a notification" requirement (docs/ESPECIFICACAO.md's daemon loop fires the same lead-time
 * instant on every 30s poll it's crossed on) is solved the same way `core/early-warnings.ts`
 * already solves it for a different trigger: `decideSchedule` returns the bookkeeping to persist
 * next (`nextState`) alongside the decision, and the caller only carries it forward after actually
 * acting on the decision — this file never assumes an action succeeded.
 */
import type { Config, Day, DayState } from './types.js';
import { localDayString } from './day.js';

/**
 * Resolves `"HH:MM"` (already validated 24h local time by
 * `adapters/storage/config-schema.ts` — this function trusts the shape, same as every other
 * `core/` rule trusts its typed input) against `referenceDay`'s local calendar day into a concrete
 * instant. `docs/ARQUITETURA.md` § "Fusos e horários": "a conversão para instante acontece por
 * dia, no fuso do sistema, o que trata mudança de horário de verão de graça" — `new Date(year,
 * month, day, hours, minutes)` IS that conversion (D-019 permits a deterministic `Date`
 * construction from already-known values); this function does no DST arithmetic of its own, it
 * just hands the platform the wall-clock numbers and lets the timezone database decide what
 * instant they mean today, the same way `adapters/git/local-day.ts#localDayBounds` already does
 * for day boundaries.
 *
 * **The entry day of daylight saving — a configured time that never happens.** Measured on
 * Node/V8 (`TZ=America/New_York`, spring-forward 2026-03-08, clocks jump 02:00→03:00 so "02:30"
 * never occurs that day): `new Date(2026, 2, 8, 2, 30)` normalizes to **03:30 local**, not 01:30
 * and not a thrown error. This function doesn't special-case it — rejecting an "impossible"
 * configured time would mean `core/` carrying its own DST transition table, exactly what "no fuso
 * do sistema, de graça" exists to avoid — and the platform's own normalization always lands AFTER
 * the gap, never before it: closing 30 minutes later than configured one morning a year is a far
 * smaller cost than a scheduler that throws, or silently never closes, because the configured
 * minute briefly didn't exist.
 *
 * **The exit day — a configured time that happens twice.** Measured the same way (fall-back
 * 2026-11-01, clocks fall 02:00→01:00, so "01:30" occurs once in daylight time and again an hour
 * later in standard time): `new Date(2026, 10, 1, 1, 30)` resolves to the EARLIER (still-daylight)
 * occurrence. Same reasoning: this is the platform's own disambiguation rule, not one this project
 * invented, and there is no information available here (a bare `"HH:MM"` string) that could
 * justify picking the later one instead.
 */
export function resolveEndOfDayInstant(endOfDayTime: string, referenceDay: Date): Date {
  const [hours, minutes] = endOfDayTime.split(':').map(Number);
  return new Date(
    referenceDay.getFullYear(),
    referenceDay.getMonth(),
    referenceDay.getDate(),
    hours,
    minutes,
    0,
    0,
  );
}

/**
 * Shifts `nominal` by `snoozeMinutesTotal` minutes of real elapsed time ("close N minutes later
 * than you otherwise would have"), never a second wall-clock time to re-resolve through the
 * timezone database. `resolveEndOfDayInstant` already spent the DST reasoning for `nominal`
 * itself; shifting its result by a plain duration is ordinary arithmetic on an instant, same as
 * `core/day.ts#subtractLocalDays` deliberately does NOT do (that one preserves a wall-clock
 * time-of-day across a day boundary, a different operation from this one).
 */
function addSnoozeOffset(nominal: Date, snoozeMinutesTotal: number): Date {
  return new Date(nominal.getTime() + snoozeMinutesTotal * 60_000);
}

/**
 * Today's *effective* end-of-day instant: the nominal `endOfDayTime` (`resolveEndOfDayInstant`,
 * above) plus every "adiar" increment applied so far (`DayState.snoozeMinutesTotal`). `null` when
 * `endOfDayTime` itself is `null` — docs/ESPECIFICACAO.md's manual-only mode, nothing to compute
 * at all (D-025: absence of configuration is not "midnight" or any other invented instant).
 *
 * Exported mainly for `seeya status`'s "quanto falta" (docs/QUESTOES.md Q-015) — `decideSchedule`
 * below needs the exact same instant but keeps its own call to `resolveEndOfDayInstant` +
 * `addSnoozeOffset` rather than this wrapper, only to avoid re-deriving "was `endOfDayTime` null"
 * from this function's `Date | null` return after already branching on it once.
 */
export function computeEffectiveEndOfDay(
  endOfDayTime: string | null,
  snoozeMinutesTotal: number,
  now: Date,
): Date | null {
  if (endOfDayTime === null) {
    return null;
  }
  return addSnoozeOffset(resolveEndOfDayInstant(endOfDayTime, now), snoozeMinutesTotal);
}

/** The bookkeeping a local day starts from — no skip, no snooze, no notification fired yet
 * (D-025: a day nobody has touched yet is not an error, and isn't half-way through anything). */
export function emptyDayState(day: Day): DayState {
  return {
    day,
    skipped: false,
    snoozeMinutesTotal: 0,
    firedLeadTimesInMinutes: [],
    endOfDayFired: false,
  };
}

/**
 * `state` if it already belongs to `today`, or a fresh `emptyDayState(today)` otherwise —
 * `docs/TESTES.md`'s "virada de meia-noite zerando o estado do dia". Shared by every function
 * below that touches a `DayState`, so the reset rule lives in exactly one place: a state object
 * left over from yesterday (whatever a real `Storage` implementation ends up handing back, S4-T3)
 * never leaks a stale `skipped`/`snoozeMinutesTotal`/`endOfDayFired` into a new local day.
 */
function resetIfNewDay(state: DayState, today: Day): DayState {
  return state.day === today ? state : emptyDayState(today);
}

/**
 * Applies one "adiar" increment (D-006: `+15m`/`+30m`/`+1h`, or any positive number of minutes —
 * this function doesn't re-enforce the specific enum the CLI's own flag parsing offers, since
 * "add N minutes" has no reason to know which increments a UI happens to expose). Cumulative: a
 * second call adds to the first (`docs/TESTES.md`'s "adiar duas vezes"), never replaces it — D-006
 * is explicit that there is no cap. Works identically whether called before or after the nominal
 * `endOfDayTime` has already passed (`docs/TESTES.md`'s "adiar antes"/"adiar depois do horário"):
 * the offset always adds to the *nominal* instant, never to `now`, so the resulting effective
 * deadline is the same regardless of when today the increment was requested.
 */
export function applySnooze(state: DayState, today: Day, minutesToAdd: number): DayState {
  const current = resetIfNewDay(state, today);
  return { ...current, snoozeMinutesTotal: current.snoozeMinutesTotal + minutesToAdd };
}

/** Applies "pular hoje" (D-006). Idempotent, and independent of any snooze already applied today
 * (`docs/TESTES.md`'s "pular depois de já ter adiado" — the accumulated `snoozeMinutesTotal` is
 * left untouched; it simply stops mattering once `decideSchedule` sees `skipped: true`). */
export function applySkipToday(state: DayState, today: Day): DayState {
  const current = resetIfNewDay(state, today);
  return { ...current, skipped: true };
}

/**
 * Finds the most urgent not-yet-fired lead time that's due at `now`. Evaluated in **descending**
 * order of minutes, independent of the order `Config.leadTimesInMinutes` happens to list them in:
 * in real time, the largest lead time's threshold (e.g. 30 minutes before) is crossed before the
 * smallest one's (15 minutes before), so descending order is the order they'd naturally fire in.
 * This only matters when more than one threshold is due at the same check — normally impossible
 * with a 30s poll, but exactly what happens after the machine wakes from suspension having missed
 * several: this returns the one whose absolute instant came first, so a delayed catch-up doesn't
 * announce the 15-minute warning before the 30-minute one. `docs/QUESTOES.md` Q-037 flags this as
 * a spec-silent choice, not a literal requirement.
 */
function findDueLeadTime(
  leadTimesInMinutes: readonly number[],
  alreadyFired: readonly number[],
  effectiveEndOfDay: Date,
  now: Date,
): number | null {
  const byUrgency = [...leadTimesInMinutes].sort((a, b) => b - a);
  for (const leadTime of byUrgency) {
    if (alreadyFired.includes(leadTime)) {
      continue;
    }
    const warnAt = effectiveEndOfDay.getTime() - leadTime * 60_000;
    if (now.getTime() >= warnAt) {
      return leadTime;
    }
  }
  return null;
}

/**
 * "What should happen right now" (docs/ESPECIFICACAO.md § "Comportamento do daemon"), named
 * explicitly instead of a boolean (D-024, this file's top comment):
 *
 * - `disabled` — `Config.endOfDayTime` is `null` (manual-only mode). Nothing else here applies.
 * - `skipped` — today was skipped (`seeya skip-today`). Checked before anything time-based, per
 *   the spec's own first bullet ("se hoje foi pulado → não faz nada").
 * - `alreadyEnded` — today's closure already ran; nothing left to do until the next local day.
 *   Sticky: once produced, a later snooze cannot reopen a day that already closed (there's nothing
 *   left to delay).
 * - `waiting` — before the next lead-time warning and before the close, or between two lead-time
 *   warnings. `effectiveEndOfDay` is exposed so a caller (`seeya status`, S4-T4) can show "quanto
 *   falta" without recomputing the snooze arithmetic.
 * - `leadTimeWarning` — one configured advance notice is due and hasn't fired today
 *   (`leadTimeMinutes` names which one; `nextState` already marks it fired).
 * - `endOfDay` — the effective deadline has been reached or passed. `delayMs` is the raw gap
 *   between `now` and `effectiveEndOfDay` — **not** a `late: boolean`, on purpose: a boolean would
 *   erase exactly the distinction docs/ESPECIFICACAO.md asks for ("se a máquina estava suspensa e
 *   o horário passou sem disparo, o encerramento acontece... com aviso de que houve atraso"). A
 *   normal on-time trigger has `delayMs` on the order of one poll interval (≤30s);
 *   a machine waking from suspension hours later has `delayMs` in the hours — the caller decides
 *   from the actual number whether "aviso de atraso" applies and how to word it, instead of this
 *   function guessing a threshold it has no basis to pick.
 */
export type ScheduleDecision =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'alreadyEnded'; readonly effectiveEndOfDay: Date }
  | { readonly kind: 'waiting'; readonly effectiveEndOfDay: Date }
  | {
      readonly kind: 'leadTimeWarning';
      readonly leadTimeMinutes: number;
      readonly effectiveEndOfDay: Date;
    }
  | { readonly kind: 'endOfDay'; readonly effectiveEndOfDay: Date; readonly delayMs: number };

export interface ScheduleDecisionResult {
  readonly decision: ScheduleDecision;
  /** What to persist before the next poll — only meaningfully different from the input `state`
   * for `leadTimeWarning`/`endOfDay` (marks the thing just decided as fired) and for a day
   * rollover. The caller only carries this forward after acting on `decision` succeeds — this
   * function never assumes it did (this file's top comment). */
  readonly nextState: DayState;
}

/**
 * The `endOfDayFired`/`endOfDay`/`leadTimeWarning`/`waiting` half of `decideSchedule`, split out
 * once `disabled`/`skipped` are already ruled out and `effectiveEndOfDay` is known — kept separate
 * so neither function runs past AGENTS.md's ~20-line guideline (`decideSchedule` would otherwise
 * mix "is there a schedule active at all today" with "where are we against it").
 */
function decideAgainstDeadline(
  leadTimesInMinutes: readonly number[],
  current: DayState,
  effectiveEndOfDay: Date,
  now: Date,
): ScheduleDecisionResult {
  if (current.endOfDayFired) {
    return { decision: { kind: 'alreadyEnded', effectiveEndOfDay }, nextState: current };
  }
  if (now.getTime() >= effectiveEndOfDay.getTime()) {
    const delayMs = now.getTime() - effectiveEndOfDay.getTime();
    return {
      decision: { kind: 'endOfDay', effectiveEndOfDay, delayMs },
      nextState: { ...current, endOfDayFired: true },
    };
  }

  const dueLeadTime = findDueLeadTime(
    leadTimesInMinutes,
    current.firedLeadTimesInMinutes,
    effectiveEndOfDay,
    now,
  );
  if (dueLeadTime === null) {
    return { decision: { kind: 'waiting', effectiveEndOfDay }, nextState: current };
  }
  return {
    decision: { kind: 'leadTimeWarning', leadTimeMinutes: dueLeadTime, effectiveEndOfDay },
    nextState: {
      ...current,
      firedLeadTimesInMinutes: [...current.firedLeadTimesInMinutes, dueLeadTime],
    },
  };
}

/**
 * The daemon's one question, asked every poll (docs/ESPECIFICACAO.md: "Loop de verificação a cada
 * 30 s"): given `config`, the last persisted `state`, and `now`, what should happen?
 *
 * @example
 * const { decision, nextState } = decideSchedule(config, state, clock.now());
 * if (decision.kind === 'endOfDay') { await endDay(...); await storage.saveState(nextState); }
 */
export function decideSchedule(config: Config, state: DayState, now: Date): ScheduleDecisionResult {
  const current = resetIfNewDay(state, localDayString(now));

  if (config.endOfDayTime === null) {
    return { decision: { kind: 'disabled' }, nextState: current };
  }
  if (current.skipped) {
    return { decision: { kind: 'skipped' }, nextState: current };
  }

  const effectiveEndOfDay = addSnoozeOffset(
    resolveEndOfDayInstant(config.endOfDayTime, now),
    current.snoozeMinutesTotal,
  );
  return decideAgainstDeadline(config.leadTimesInMinutes, current, effectiveEndOfDay, now);
}
