/**
 * `core/schedule.ts` (S4-T2) — docs/TESTES.md's first two `core/` unit-test bullets:
 *
 * 1. "Cálculo do instante de encerramento a partir de `endOfDayTime` + data + fuso": dia normal;
 *    dia de entrada de horário de verão; dia de saída; horário já passado; `endOfDayTime: null`.
 * 2. "Adiamento e pular-hoje": adiar antes do horário; adiar depois do horário; adiar duas vezes;
 *    pular depois de já ter adiado; virada de meia-noite zerando o estado do dia.
 *
 * The DST describe block below forces `process.env.TZ` to a zone that still observes daylight
 * saving (`America/New_York`) and restores it afterward — Node/V8 re-reads `TZ` on every `Date`
 * construction (measured directly against this project's own Node before writing these tests: an
 * env-var change mid-process is picked up immediately, even after `Date` was already used earlier
 * under a different zone), and the official Node binary this project targets (D-008, Node 22 LTS)
 * always bundles full ICU/timezone data, independent of the host OS's own tzdata — so this is
 * expected to behave the same on Windows, Linux and macOS CI.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySkipToday,
  applySnooze,
  computeEffectiveEndOfDay,
  decideSchedule,
  emptyDayState,
  resolveEndOfDayInstant,
} from '../../../src/core/schedule.js';
import { createConfig } from './_fixtures.js';

describe('resolveEndOfDayInstant — ordinary day', () => {
  it('resolves "HH:MM" against the reference day, in local time', () => {
    const instant = resolveEndOfDayInstant('19:30', new Date(2026, 5, 15, 8, 0, 0));
    expect(instant.getFullYear()).toBe(2026);
    expect(instant.getMonth()).toBe(5);
    expect(instant.getDate()).toBe(15);
    expect(instant.getHours()).toBe(19);
    expect(instant.getMinutes()).toBe(30);
  });

  it('an already-passed configured time still resolves to today, not tomorrow', () => {
    // "now" is 20:00, an hour after the configured 19:30 — the calculation itself doesn't know
    // or care about "now"; it must not roll forward looking for the "next" 19:30.
    const instant = resolveEndOfDayInstant('19:30', new Date(2026, 5, 15, 20, 0, 0));
    expect(instant.getDate()).toBe(15);
    expect(instant.getHours()).toBe(19);
    const now = new Date(2026, 5, 15, 20, 0, 0);
    expect(instant.getTime()).toBeLessThan(now.getTime());
  });
});

describe('resolveEndOfDayInstant — daylight saving transitions (America/New_York, 2026)', () => {
  const originalTZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });

  afterAll(() => {
    if (originalTZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTZ;
    }
  });

  it('entry day (spring forward, 2026-03-08): a nonexistent wall-clock time normalizes forward, past the gap', () => {
    // Clocks jump 02:00 -> 03:00 that day, so "02:30" never happens. Measured: V8 resolves it to
    // 03:30, not 01:30 and not a throw — see this module's own docstring for why that's accepted
    // instead of special-cased.
    const instant = resolveEndOfDayInstant('02:30', new Date(2026, 2, 8, 0, 0, 0));
    expect(instant.getDate()).toBe(8);
    expect(instant.getHours()).toBe(3);
    expect(instant.getMinutes()).toBe(30);
  });

  it('entry day: a time before the gap resolves normally, unaffected', () => {
    const instant = resolveEndOfDayInstant('01:30', new Date(2026, 2, 8, 0, 0, 0));
    expect(instant.getHours()).toBe(1);
    expect(instant.getMinutes()).toBe(30);
  });

  it('entry day: a time after the gap resolves normally, unaffected', () => {
    const instant = resolveEndOfDayInstant('19:30', new Date(2026, 2, 8, 0, 0, 0));
    expect(instant.getHours()).toBe(19);
    expect(instant.getMinutes()).toBe(30);
  });

  it('exit day (fall back, 2026-11-01): the ambiguous, twice-occurring wall-clock time resolves to its earlier occurrence', () => {
    // Clocks fall 02:00 -> 01:00 that day, so "01:30" happens once at UTC-4 (still daylight) and
    // again an hour later at UTC-5 (standard). Measured: V8 picks the earlier (still-daylight)
    // instant — see this module's own docstring for why this project doesn't second-guess it.
    const instant = resolveEndOfDayInstant('01:30', new Date(2026, 10, 1, 0, 0, 0));
    expect(instant.getTimezoneOffset()).toBe(240); // UTC-4, daylight time — the earlier occurrence
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('exit day: an ordinary time outside the fold resolves normally', () => {
    const instant = resolveEndOfDayInstant('19:30', new Date(2026, 10, 1, 0, 0, 0));
    expect(instant.getHours()).toBe(19);
    expect(instant.getTimezoneOffset()).toBe(300); // UTC-5, standard time by evening
  });
});

describe('computeEffectiveEndOfDay', () => {
  it('endOfDayTime: null means disabled — never an invented instant (D-025)', () => {
    expect(computeEffectiveEndOfDay(null, 0, new Date(2026, 5, 15, 12, 0, 0))).toBeNull();
  });

  it('adds the cumulative snooze offset, in minutes, to the nominal instant', () => {
    const now = new Date(2026, 5, 15, 12, 0, 0);
    const effective = computeEffectiveEndOfDay('19:30', 45, now);
    expect(effective).not.toBeNull();
    expect(effective?.getHours()).toBe(20);
    expect(effective?.getMinutes()).toBe(15);
  });

  it('zero snooze leaves the nominal instant untouched', () => {
    const now = new Date(2026, 5, 15, 12, 0, 0);
    const effective = computeEffectiveEndOfDay('19:30', 0, now);
    expect(effective?.getTime()).toBe(resolveEndOfDayInstant('19:30', now).getTime());
  });
});

describe('applySnooze', () => {
  it('adds one increment to a fresh day', () => {
    const state = applySnooze(emptyDayState('2026-08-16'), '2026-08-16', 15);
    expect(state.snoozeMinutesTotal).toBe(15);
  });

  it('applied before the nominal end-of-day time still just adds to the total', () => {
    // The function doesn't take "now" at all — "before"/"after" only matters to the caller
    // deciding *when* to invoke it, never to the arithmetic itself.
    const state = applySnooze(emptyDayState('2026-08-16'), '2026-08-16', 30);
    expect(state.snoozeMinutesTotal).toBe(30);
  });

  it('two snoozes accumulate — docs/TESTES.md "adiar duas vezes"', () => {
    const once = applySnooze(emptyDayState('2026-08-16'), '2026-08-16', 15);
    const twice = applySnooze(once, '2026-08-16', 30);
    expect(twice.snoozeMinutesTotal).toBe(45);
  });

  it('resets stale bookkeeping from a previous day before adding (midnight rollover)', () => {
    const stale = {
      ...emptyDayState('2026-08-15'),
      skipped: true,
      snoozeMinutesTotal: 999,
      endOfDayFired: true,
    };
    const state = applySnooze(stale, '2026-08-16', 15);
    expect(state).toStrictEqual({
      day: '2026-08-16',
      skipped: false,
      snoozeMinutesTotal: 15,
      firedLeadTimesInMinutes: [],
      endOfDayFired: false,
      captureAttemptsToday: {},
    });
  });
});

describe('applySkipToday', () => {
  it('sets skipped on a fresh day', () => {
    const state = applySkipToday(emptyDayState('2026-08-16'), '2026-08-16');
    expect(state.skipped).toBe(true);
  });

  it('skipping after already having snoozed keeps the snooze total, just adds skipped — docs/TESTES.md "pular depois de já ter adiado"', () => {
    const snoozed = applySnooze(emptyDayState('2026-08-16'), '2026-08-16', 30);
    const state = applySkipToday(snoozed, '2026-08-16');
    expect(state.skipped).toBe(true);
    expect(state.snoozeMinutesTotal).toBe(30);
  });

  it('resets stale bookkeeping from a previous day before skipping (midnight rollover)', () => {
    const stale = { ...emptyDayState('2026-08-15'), snoozeMinutesTotal: 60 };
    const state = applySkipToday(stale, '2026-08-16');
    expect(state).toStrictEqual({
      day: '2026-08-16',
      skipped: true,
      snoozeMinutesTotal: 0,
      firedLeadTimesInMinutes: [],
      endOfDayFired: false,
      captureAttemptsToday: {},
    });
  });
});

describe('decideSchedule — disabled and skipped', () => {
  it('endOfDayTime: null is "disabled", regardless of any other state', () => {
    const config = createConfig({ endOfDayTime: null });
    const state = { ...emptyDayState('2026-08-16'), skipped: true };
    const { decision } = decideSchedule(config, state, new Date(2026, 7, 16, 20, 0, 0));
    expect(decision).toStrictEqual({ kind: 'disabled' });
  });

  it('a skipped day does nothing, even once the effective end-of-day time has passed', () => {
    const config = createConfig({ endOfDayTime: '19:30' });
    const state = applySkipToday(emptyDayState('2026-08-16'), '2026-08-16');
    const { decision } = decideSchedule(config, state, new Date(2026, 7, 16, 20, 0, 0));
    expect(decision).toStrictEqual({ kind: 'skipped' });
  });
});

describe('decideSchedule — waiting, lead-time warnings, end of day', () => {
  it('well before any lead time is "waiting", carrying the effective deadline', () => {
    const config = createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [30, 15] });
    const { decision } = decideSchedule(
      config,
      emptyDayState('2026-08-16'),
      new Date(2026, 7, 16, 18, 0, 0),
    );
    expect(decision.kind).toBe('waiting');
    if (decision.kind === 'waiting') {
      expect(decision.effectiveEndOfDay.getHours()).toBe(19);
      expect(decision.effectiveEndOfDay.getMinutes()).toBe(30);
    }
  });

  it('crossing the 30-minute mark fires that lead-time warning', () => {
    const config = createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [30, 15] });
    const { decision, nextState } = decideSchedule(
      config,
      emptyDayState('2026-08-16'),
      new Date(2026, 7, 16, 19, 0, 0),
    );
    expect(decision).toMatchObject({ kind: 'leadTimeWarning', leadTimeMinutes: 30 });
    expect(nextState.firedLeadTimesInMinutes).toStrictEqual([30]);
  });

  it('does not repeat a lead-time warning already recorded as fired — a 30s-later poll at the same instant sees "waiting"', () => {
    const config = createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [30, 15] });
    const first = decideSchedule(
      config,
      emptyDayState('2026-08-16'),
      new Date(2026, 7, 16, 19, 0, 0),
    );
    const second = decideSchedule(config, first.nextState, new Date(2026, 7, 16, 19, 0, 5));
    expect(second.decision.kind).toBe('waiting');
  });

  it('reaching the effective end-of-day time fires the closure, with near-zero delay', () => {
    const config = createConfig({ endOfDayTime: '19:30' });
    const now = new Date(2026, 7, 16, 19, 30, 0);
    const { decision, nextState } = decideSchedule(config, emptyDayState('2026-08-16'), now);
    expect(decision).toMatchObject({ kind: 'endOfDay', delayMs: 0 });
    expect(nextState.endOfDayFired).toBe(true);
  });

  it('a suspended machine waking up two hours late still fires the closure, with the real delay carried in `delayMs` — never a `late: boolean` that would erase it', () => {
    const config = createConfig({ endOfDayTime: '19:30' });
    const now = new Date(2026, 7, 16, 21, 30, 0); // two hours after 19:30
    const { decision } = decideSchedule(config, emptyDayState('2026-08-16'), now);
    expect(decision.kind).toBe('endOfDay');
    if (decision.kind === 'endOfDay') {
      expect(decision.delayMs).toBe(2 * 60 * 60 * 1000);
    }
  });

  it('once fired, stays "alreadyEnded" for the rest of the day and does not repeat the closure', () => {
    const config = createConfig({ endOfDayTime: '19:30' });
    const fired = decideSchedule(
      config,
      emptyDayState('2026-08-16'),
      new Date(2026, 7, 16, 19, 30, 0),
    );
    const polledAgain = decideSchedule(config, fired.nextState, new Date(2026, 7, 16, 19, 30, 30));
    expect(polledAgain.decision.kind).toBe('alreadyEnded');
  });

  it('a snooze requested after already closing cannot reopen the day — "alreadyEnded" is sticky', () => {
    const config = createConfig({ endOfDayTime: '19:30' });
    const fired = decideSchedule(
      config,
      emptyDayState('2026-08-16'),
      new Date(2026, 7, 16, 19, 30, 0),
    );
    const snoozedAfterClosing = applySnooze(fired.nextState, '2026-08-16', 30);
    const { decision } = decideSchedule(
      config,
      snoozedAfterClosing,
      new Date(2026, 7, 16, 19, 45, 0),
    );
    expect(decision.kind).toBe('alreadyEnded');
  });

  it('a machine that missed both lead-time thresholds fires the more urgent (larger) one first, then the other on the next poll', () => {
    const config = createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [30, 15] });
    // 19:20: both the 30-minute (19:00) and 15-minute (19:15) marks have already passed.
    const now = new Date(2026, 7, 16, 19, 20, 0);
    const first = decideSchedule(config, emptyDayState('2026-08-16'), now);
    expect(first.decision).toMatchObject({ kind: 'leadTimeWarning', leadTimeMinutes: 30 });

    const second = decideSchedule(config, first.nextState, now);
    expect(second.decision).toMatchObject({ kind: 'leadTimeWarning', leadTimeMinutes: 15 });

    const third = decideSchedule(config, second.nextState, now);
    expect(third.decision.kind).toBe('waiting');
  });

  it('no lead times configured at all still resolves cleanly to waiting, then to the closure', () => {
    const config = createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [] });
    const before = decideSchedule(
      config,
      emptyDayState('2026-08-16'),
      new Date(2026, 7, 16, 19, 0, 0),
    );
    expect(before.decision.kind).toBe('waiting');
    const at = decideSchedule(
      config,
      emptyDayState('2026-08-16'),
      new Date(2026, 7, 16, 19, 30, 0),
    );
    expect(at.decision.kind).toBe('endOfDay');
  });
});

describe('decideSchedule — midnight rollover (docs/TESTES.md)', () => {
  it("yesterday's skipped/snoozed/fired state does not leak into a new local day", () => {
    const config = createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [30, 15] });
    const yesterday = {
      day: '2026-08-15',
      skipped: true,
      snoozeMinutesTotal: 120,
      firedLeadTimesInMinutes: [30, 15],
      endOfDayFired: true,
      captureAttemptsToday: { 'some-session-id': 2 },
    };
    const { decision, nextState } = decideSchedule(
      config,
      yesterday,
      new Date(2026, 7, 16, 18, 0, 0),
    );
    expect(decision.kind).toBe('waiting');
    expect(nextState).toStrictEqual(emptyDayState('2026-08-16'));
  });
});
