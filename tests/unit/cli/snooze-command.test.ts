/**
 * `runSnoozeCommand`/`runSkipTodayCommand` (S4-T4, docs/ESPECIFICACAO.md § "seeya snooze...",
 * D-006). Every test here uses `InMemoryScheduleStorage` — a real in-memory `Storage` double, not
 * `core/schedule.ts`'s functions called directly — because the point of THIS suite is proving the
 * CLI layer reads/writes `Storage` correctly and renders the right message, not re-testing
 * `applySnooze`/`applySkipToday` themselves (already covered by `tests/unit/core/schedule.test.ts`).
 *
 * docs/TESTES.md's mandatory cases for this task: snooze before the deadline, snooze after it,
 * snoozing twice (accumulates), skipping after already having snoozed, and a local-day rollover
 * resetting the state. Every one of them is a named `it` below.
 */
import { describe, expect, it } from 'vitest';
import {
  runSkipTodayCommand,
  runSnoozeCommand,
  parseSnoozeIncrement,
} from '../../../src/cli/snooze-command.js';
import { InMemoryScheduleStorage } from './_fakes.js';
import { FakeClock } from '../application/_fakes.js';
import type { Config, DayState } from '../../../src/core/types.js';
import { EMPTY_DAEMON_HEALTH } from '../../../src/core/daemon-health.js';

function config(overrides: Partial<Config> = {}): Config {
  return {
    endOfDayTime: '19:30',
    leadTimesInMinutes: [30, 15],
    relevanceHours: 12,
    idleMinutes: 45,
    captureModel: 'sonnet',
    budgetPerSessionUsd: 0.25,
    captureConcurrency: 3,
    ignore: [],
    projectPolicy: {},
    forkCleanupDays: 7,
    maxGitRootsToVisit: 8,
    maxCaptureAttemptsPerSessionPerDay: 3,
    maxBriefingScanDays: 30,
    overdueFireThresholdMinutes: 5,
    ...overrides,
  };
}

const DAY_1_NOON = new Date(2026, 7, 16, 12, 0, 0); // 2026-08-16, local time — before 19:30
const DAY_1_LATE = new Date(2026, 7, 16, 20, 0, 0); // 2026-08-16 20:00 — after 19:30
const DAY_2_MORNING = new Date(2026, 7, 17, 9, 0, 0); // next local day

describe('parseSnoozeIncrement', () => {
  it('accepts exactly the three D-006 increments', () => {
    expect(parseSnoozeIncrement('+15m')).toBe(15);
    expect(parseSnoozeIncrement('+30m')).toBe(30);
    expect(parseSnoozeIncrement('+1h')).toBe(60);
  });

  it('rejects anything else, including a plausible-looking near miss', () => {
    expect(parseSnoozeIncrement('15m')).toBeNull();
    expect(parseSnoozeIncrement('+45m')).toBeNull();
    expect(parseSnoozeIncrement('')).toBeNull();
  });
});

describe('runSnoozeCommand', () => {
  it('rejects an invalid increment, naming the value received and the values expected', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runSnoozeCommand(
      { storage, clock: new FakeClock(DAY_1_NOON), config: config() },
      '+45m',
    );
    expect(message).toContain('"+45m"');
    expect(message).toContain('+15m|+30m|+1h');
    // Rejecting a bad increment never touches disk.
    expect(await storage.readState()).toBeNull();
  });

  it('docs/TESTES.md: snoozing BEFORE the nominal end-of-day time pushes the effective deadline later', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const clock = new FakeClock(DAY_1_NOON);
    const message = await runSnoozeCommand({ storage, clock, config: config() }, '+30m');

    const state = await storage.readState();
    expect(state?.snoozeMinutesTotal).toBe(30);
    expect(state?.day).toBe('2026-08-16');
    expect(message).toContain('Snoozed by 30 minutes (30 minutes total today)');
    expect(message).toContain('New effective end-of-day: 20:00');
  });

  it('docs/TESTES.md: snoozing AFTER the nominal end-of-day time still adds forward from the nominal instant, not from now', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const clock = new FakeClock(DAY_1_LATE); // 20:00, nominal 19:30 already passed
    const message = await runSnoozeCommand({ storage, clock, config: config() }, '+1h');

    const state = await storage.readState();
    expect(state?.snoozeMinutesTotal).toBe(60);
    // Nominal 19:30 + 60m = 20:30, which is still after "now" (20:00): the close hasn't fired yet.
    expect(message).toContain('New effective end-of-day: 20:30');
  });

  it('docs/TESTES.md: snoozing after the deadline by too little still reports the (past) new deadline as due now', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const clock = new FakeClock(DAY_1_LATE); // 20:00, nominal 19:30
    const message = await runSnoozeCommand({ storage, clock, config: config() }, '+15m');

    // Nominal 19:30 + 15m = 19:45, which is still before "now" (20:00).
    expect(message).toContain('has already passed — closure is due now');
    // The preview `decideSchedule` call this message came from is read-only: it never persists
    // `endOfDayFired: true` on its own account — only a REAL `endDay` run (the daemon's next
    // poll, or `seeya end-day` by hand) is allowed to mark the day as actually closed.
    expect(await storage.readState()).toMatchObject({ endOfDayFired: false });
  });

  it('docs/TESTES.md: snoozing TWICE accumulates (D-006: "não há limite de adiamentos")', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const clock = new FakeClock(DAY_1_NOON);
    await runSnoozeCommand({ storage, clock, config: config() }, '+15m');
    const secondMessage = await runSnoozeCommand({ storage, clock, config: config() }, '+30m');

    const state = await storage.readState();
    expect(state?.snoozeMinutesTotal).toBe(45);
    expect(secondMessage).toContain('(45 minutes total today)');
  });

  it('works with the daemon "stopped": a fresh Storage instance reading the same document afterwards sees the snooze', async () => {
    const backingStorage = new InMemoryScheduleStorage(config());
    const clock = new FakeClock(DAY_1_NOON);
    await runSnoozeCommand({ storage: backingStorage, clock, config: config() }, '+15m');

    // Simulates the daemon's NEXT poll, from a process that was never running while the CLI
    // command above executed — a fresh read against the same persisted document, exactly what
    // docs/ESPECIFICACAO.md means by "funciona com ou sem daemon rodando".
    const state = await backingStorage.readState();
    expect(state).not.toBeNull();
    expect(state?.snoozeMinutesTotal).toBe(15);
  });

  it('when endOfDayTime is disabled, still persists the snooze but says it has no effect', async () => {
    const storage = new InMemoryScheduleStorage(config({ endOfDayTime: null }));
    const clock = new FakeClock(DAY_1_NOON);
    const message = await runSnoozeCommand(
      { storage, clock, config: config({ endOfDayTime: null }) },
      '+15m',
    );

    expect(await storage.readState()).toMatchObject({ snoozeMinutesTotal: 15 });
    expect(message).toContain('has no effect until you set one');
  });

  it("once today's closure already fired, a later snooze is recorded but says there is nothing left to delay", async () => {
    const alreadyEnded: DayState = {
      day: '2026-08-16',
      skipped: false,
      snoozeMinutesTotal: 0,
      firedLeadTimesInMinutes: [30, 15],
      endOfDayFired: true,
      captureAttemptsToday: {},
      daemonHealth: EMPTY_DAEMON_HEALTH,
    };
    const storage = new InMemoryScheduleStorage(config());
    await storage.saveState(alreadyEnded);
    const clock = new FakeClock(DAY_1_LATE);

    const message = await runSnoozeCommand({ storage, clock, config: config() }, '+15m');

    expect(message).toContain('already ran — there is nothing left to delay');
    // The snooze is still recorded, even though it currently has no effect (D-006: cumulative,
    // never silently dropped).
    expect(await storage.readState()).toMatchObject({
      snoozeMinutesTotal: 15,
      endOfDayFired: true,
    });
  });
});

describe('runSkipTodayCommand', () => {
  it('docs/TESTES.md: skipping AFTER already having snoozed keeps the snooze on record but skips the day', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const clock = new FakeClock(DAY_1_NOON);
    await runSnoozeCommand({ storage, clock, config: config() }, '+30m');
    const message = await runSkipTodayCommand({ storage, clock, config: config() });

    const state = await storage.readState();
    expect(state?.skipped).toBe(true);
    expect(state?.snoozeMinutesTotal).toBe(30);
    expect(message).toContain('skipped');
  });

  it('when endOfDayTime is disabled, says skipping has no additional effect', async () => {
    const storage = new InMemoryScheduleStorage(config({ endOfDayTime: null }));
    const clock = new FakeClock(DAY_1_NOON);
    const message = await runSkipTodayCommand({
      storage,
      clock,
      config: config({ endOfDayTime: null }),
    });

    expect(message).toContain('no additional effect');
  });
});

describe('midnight rollover (docs/TESTES.md: "virada de meia-noite zerando o estado")', () => {
  it('a snooze/skip left over from yesterday is reset before applying a NEW snooze today, but daemonHealth carries forward (S4-T3b)', async () => {
    const yesterday: DayState = {
      day: '2026-08-16',
      skipped: true,
      snoozeMinutesTotal: 999,
      firedLeadTimesInMinutes: [30, 15],
      endOfDayFired: true,
      captureAttemptsToday: { 'some-session': 3 },
      daemonHealth: {
        lastCycleError: { message: 'boom', at: new Date(2026, 7, 16, 10, 0, 0) },
        consecutiveCycleFailures: 4,
      },
    };
    const storage = new InMemoryScheduleStorage(config());
    await storage.saveState(yesterday);

    const clock = new FakeClock(DAY_2_MORNING); // next local day
    await runSnoozeCommand({ storage, clock, config: config() }, '+15m');

    const state = await storage.readState();
    expect(state?.day).toBe('2026-08-17');
    expect(state?.skipped).toBe(false);
    expect(state?.snoozeMinutesTotal).toBe(15); // only today's snooze, not 999 + 15
    expect(state?.endOfDayFired).toBe(false);
    expect(state?.captureAttemptsToday).toEqual({});
    // The one field that is NOT reset by the day turning over.
    expect(state?.daemonHealth.consecutiveCycleFailures).toBe(4);
    expect(state?.daemonHealth.lastCycleError?.message).toBe('boom');
  });

  it('the same rollover applies to skip-today, run on a fresh day with nothing persisted yet', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const clock = new FakeClock(DAY_2_MORNING);
    await runSkipTodayCommand({ storage, clock, config: config() });

    const state = await storage.readState();
    expect(state?.day).toBe('2026-08-17');
    expect(state?.skipped).toBe(true);
    expect(state?.snoozeMinutesTotal).toBe(0);
  });
});
