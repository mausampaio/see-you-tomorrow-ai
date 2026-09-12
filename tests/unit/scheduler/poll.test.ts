/**
 * `scheduler/poll.ts` (S4-T3) — one full daemon poll cycle. Exercises the real
 * `application/endDay` pipeline (not mocked away) so the active-turn retry and non-model retry
 * budget are proven against the actual capture flow, not a stand-in for it.
 */
import { describe, expect, it } from 'vitest';
import { pollOnce } from '../../../src/scheduler/poll.js';
import { applySnooze, emptyDayState } from '../../../src/core/schedule.js';
import { createConfig, createSessionWithPid } from '../core/_fixtures.js';
import {
  FakeForkCleanup,
  FakeGitReader,
  FakeSessionProvider,
  FakeTranscriptReader,
  failingGenerator,
  succeedingGenerator,
} from '../application/_fakes.js';
import { ControllableProcessControl, InMemoryDaemonStorage, RecordingNotifier } from './_fakes.js';
import type { DaemonDeps } from '../../../src/scheduler/types.js';
import type { Config, DiscoveredSession } from '../../../src/core/types.js';
import type { EarlyWarning } from '../../../src/core/early-warnings.js';
import type { HandoffGenerator, ProcessControl } from '../../../src/core/ports.js';

interface FixedClock {
  now(): Date;
  sleep(): Promise<void>;
}

function clockAt(instant: Date): FixedClock {
  return { now: () => instant, sleep: () => Promise.resolve() };
}

interface TestHarness {
  readonly storage: InMemoryDaemonStorage;
  readonly notifier: RecordingNotifier;
  poll(now: Date, options?: { readonly sessions?: readonly DiscoveredSession[] }): Promise<void>;
}

/**
 * One shared `InMemoryDaemonStorage`/`RecordingNotifier` across every `poll()` call in a test — the
 * same object a real daemon would carry across its own 30s cycles (`estado.json` persisted, not
 * kept in memory, docs/ESPECIFICACAO.md).
 */
function buildHarness(
  config: Config,
  options: {
    readonly transcriptReader?: FakeTranscriptReader;
    readonly leanGenerator?: HandoffGenerator;
    readonly earlyWarnings?: readonly EarlyWarning[];
    readonly processControl?: ProcessControl;
  } = {},
): TestHarness {
  const storage = new InMemoryDaemonStorage(config);
  const notifier = new RecordingNotifier();
  const poll = (
    now: Date,
    pollOptions: { readonly sessions?: readonly DiscoveredSession[] } = {},
  ) => {
    const deps: DaemonDeps = {
      clock: clockAt(now),
      storage,
      notifier,
      processControl: options.processControl ?? new ControllableProcessControl(),
      transcriptReader: options.transcriptReader ?? new FakeTranscriptReader(),
      gitReader: new FakeGitReader(),
      forkCleanup: new FakeForkCleanup(),
      buildSessionProvider: () =>
        new FakeSessionProvider({ sessions: [...(pollOptions.sessions ?? [])], rejected: [] }),
      buildGenerators: () => ({
        leanGenerator:
          options.leanGenerator ??
          succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
        deepGenerator: succeedingGenerator({
          understanding: '',
          pendingItems: [],
          tomorrowPlan: [],
        }),
      }),
      discoverEarlyWarnings: () => Promise.resolve(options.earlyWarnings ?? []),
    };
    return pollOnce(deps);
  };
  return { storage, notifier, poll };
}

describe('pollOnce — disabled/skipped/waiting: no writes, no notices', () => {
  it('endOfDayTime: null never persists a state and never notifies', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: null }));
    await harness.poll(new Date(2026, 8, 5, 20, 0, 0));
    expect(await harness.storage.readState()).toBeNull();
    expect(harness.notifier.notices).toStrictEqual([]);
  });

  it('long before the lead time: waiting, no writes', async () => {
    const harness = buildHarness(createConfig());
    await harness.poll(new Date(2026, 8, 5, 8, 0, 0));
    expect(await harness.storage.readState()).toBeNull();
    expect(harness.notifier.notices).toStrictEqual([]);
  });
});

describe('pollOnce — early warnings run every poll, independent of the schedule', () => {
  it('notifies a new early warning even when the day is disabled', async () => {
    const warning: EarlyWarning = {
      kind: 'missingTranscript',
      sessionId: 'session-a',
      message: 'Session "x" has no transcript.',
    };
    const harness = buildHarness(createConfig({ endOfDayTime: null }), {
      earlyWarnings: [warning],
    });
    await harness.poll(new Date(2026, 8, 5, 20, 0, 0));
    expect(harness.notifier.notices).toHaveLength(1);
    // S4-T7 Part 2: batched now, not the raw `warning.message` verbatim — the title declares the
    // count and the body is built by `buildEarlyWarningsNotice` (covered on its own in
    // `tests/unit/scheduler/notices.test.ts`); here it's enough to prove the poll actually reaches
    // that builder with the new warning.
    expect(harness.notifier.notices[0]?.title).toBe('seeya: 1 early warning');
    expect(harness.notifier.notices[0]?.body).toContain('Session "x" has no transcript.');
  });
});

describe('pollOnce — leadTimeWarning', () => {
  it('notifies once and persists the fired lead time; a repeat poll at the same instant does not notify again', async () => {
    const harness = buildHarness(
      createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [30, 15] }),
    );
    const at1900 = new Date(2026, 8, 5, 19, 0, 0);

    await harness.poll(at1900);
    expect(harness.notifier.notices).toHaveLength(1);
    expect(harness.notifier.notices[0]?.title).toContain('30 min');
    const stateAfterFirst = await harness.storage.readState();
    expect(stateAfterFirst?.firedLeadTimesInMinutes).toStrictEqual([30]);
    expect(stateAfterFirst?.endOfDayFired).toBe(false);

    await harness.poll(at1900);
    expect(harness.notifier.notices).toHaveLength(1); // still just the one — no repeat
  });

  // S4-T6, D-025: measured in the first real rehearsal — a daemon that starts polling late (or
  // wakes from suspension) can cross the 30-minute threshold when LESS than 30 real minutes are
  // left. The notice must say the real number, not the configured rule's own name.
  it('reports the ACTUAL remaining time, not the configured lead time that fired, when the daemon is checking late', async () => {
    const harness = buildHarness(
      createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [30, 15] }),
    );
    const checkedLate = new Date(2026, 8, 5, 19, 10, 0); // 20 real minutes left, not 30

    await harness.poll(checkedLate);

    expect(harness.notifier.notices).toHaveLength(1);
    expect(harness.notifier.notices[0]?.title).toContain('20 min');
    expect(harness.notifier.notices[0]?.title).not.toContain('30 min');
    // The bookkeeping still records the CONFIGURED rule that fired — only the notice text changed.
    const state = await harness.storage.readState();
    expect(state?.firedLeadTimesInMinutes).toStrictEqual([30]);
  });
});

describe('pollOnce — S4-T7 Part 1: hysteresis suppresses a near-duplicate leadTimeWarning', () => {
  it('the measured bug, end to end: daemon starting late crosses two thresholds at once — one notice, not two', async () => {
    // Both the 30- and 15-minute marks are already crossed the instant the daemon starts (10 real
    // minutes left before 14:30) — docs/PLANO-DE-ENTREGA.md S4-T7's own measured case.
    const harness = buildHarness(
      createConfig({ endOfDayTime: '14:30', leadTimesInMinutes: [30, 15] }),
    );
    const startedLate = new Date(2026, 8, 5, 14, 20, 0);
    await harness.poll(startedLate, { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(1);
    expect(harness.notifier.notices[0]?.title).toContain('10 min');

    // 30s later (the real daemon's own poll cadence) rule 15 becomes the next unfired rule —
    // decideSchedule still proposes it (core/schedule.ts is unchanged, cuidado (d)) but hysteresis
    // swallows the actual notification: the previous one went out 30s ago, well under the 3-minute
    // default gap.
    await harness.poll(new Date(startedLate.getTime() + 30_000), { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(1); // still just the one

    // The swallowed notice still "counts as data" (cuidado (a)): the rule is marked fired AND the
    // hysteresis clock moved forward, so it never gets redelivered later.
    const state = await harness.storage.readState();
    expect(state?.firedLeadTimesInMinutes).toStrictEqual([30, 15]);
    expect(state?.lastLeadTimeWarningNoticeAt).toStrictEqual(
      new Date(startedLate.getTime() + 30_000),
    );
  });

  it('a gap past the configured hysteresis window is NOT suppressed — two genuinely spaced-out warnings both notify', async () => {
    const harness = buildHarness(
      createConfig({
        endOfDayTime: '19:30',
        leadTimesInMinutes: [30, 15],
        leadTimeHysteresisMinutes: 3,
      }),
    );
    await harness.poll(new Date(2026, 8, 5, 19, 0, 0), { sessions: [] }); // 30 fires
    expect(harness.notifier.notices).toHaveLength(1);

    // 15 minutes later — well past the 3-minute hysteresis gap.
    await harness.poll(new Date(2026, 8, 5, 19, 15, 0), { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(2);
    expect(harness.notifier.notices[1]?.title).toContain('15 min');
  });
});

describe('pollOnce — S4-T7 cuidado (a): an endOfDay result is NEVER silenced by a recent leadTimeWarning', () => {
  it('a closure that lands moments after a lead-time warning still notifies', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30', leadTimesInMinutes: [1] }));
    await harness.poll(new Date(2026, 8, 5, 19, 29, 0), { sessions: [] }); // 1-min warning fires
    expect(harness.notifier.notices).toHaveLength(1);
    expect(harness.notifier.notices[0]?.title).toContain('1 min');

    // Only 65 seconds later — well inside the 3-minute default hysteresis window — but this is an
    // `endOfDay` notice, a different class entirely: hysteresis (leadTimeWarning-only, S4-T7's own
    // structure) never even runs for it.
    await harness.poll(new Date(2026, 8, 5, 19, 30, 5), { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(2);
    expect(harness.notifier.notices[1]?.body).toContain('captured');
  });
});

describe('pollOnce — S4-T7 Part 1 + Part 3 interaction (cuidado (b))', () => {
  it('a snooze given seconds before a threshold does not cause an immediate burst — hysteresis still gates the re-fired rule', async () => {
    const harness = buildHarness(
      createConfig({ endOfDayTime: '14:30', leadTimesInMinutes: [30, 15] }),
    );
    const firstFire = new Date(2026, 8, 5, 14, 20, 0); // both 30/15 already overdue for 14:30
    await harness.poll(firstFire, { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(1); // rule 30 — first of the day

    // Snooze +15m moments later: the effective deadline moves from 14:30 to 14:45. S4-T7 Part 3
    // makes both configured rules due again for the NEW deadline.
    const beforeSnooze = await harness.storage.readState();
    const snoozed = applySnooze(beforeSnooze!, '2026-09-05', 15);
    await harness.storage.saveState(snoozed);

    // 15s after the snooze — rule 30 is due again for 14:45 (warnAt 14:15), but the hysteresis
    // clock (from the ORIGINAL notice) is untouched by the snooze: only 15s have passed.
    await harness.poll(new Date(firstFire.getTime() + 15_000), { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(1); // no burst — still just the one

    // Once the 15-minute rule's OWN threshold for the new 14:45 deadline genuinely arrives
    // (14:30) — and the hysteresis window has long since cleared — it notifies normally.
    await harness.poll(new Date(2026, 8, 5, 14, 30, 0), { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(2);
    expect(harness.notifier.notices[1]?.title).toContain('15 min');
  });
});

describe('pollOnce — endOfDay, on time, nothing captured', () => {
  it('finalizes immediately, notifying an on-time (not delayed) closure', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }));
    const justAfter = new Date(2026, 8, 5, 19, 30, 5); // 5s past — ordinary poll jitter
    await harness.poll(justAfter, { sessions: [] });

    const state = await harness.storage.readState();
    expect(state?.endOfDayFired).toBe(true);
    expect(harness.notifier.notices).toHaveLength(1);
    expect(harness.notifier.notices[0]?.title).not.toContain('delayed');
  });

  it('a second poll after closing does nothing more (alreadyEnded)', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }));
    const justAfter = new Date(2026, 8, 5, 19, 30, 5);
    await harness.poll(justAfter, { sessions: [] });
    await harness.poll(new Date(2026, 8, 5, 19, 31, 0), { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(1); // still just the one close notice
  });
});

describe('pollOnce — endOfDay, delayed (machine woke up late)', () => {
  it('a delay past the 5-minute threshold is distinguishable from an on-time close', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }));
    const wokeUpLate = new Date(2026, 8, 5, 19, 45, 0); // 15 minutes late
    await harness.poll(wokeUpLate, { sessions: [] });

    expect(harness.notifier.notices).toHaveLength(1);
    expect(harness.notifier.notices[0]?.title).toContain('delayed');
    expect(await harness.storage.readState()).toMatchObject({ endOfDayFired: true });
  });
});

describe('pollOnce — active-turn retry (docs/ESPECIFICACAO.md: up to 5 minutes)', () => {
  const SESSION_ID = '11111111-1111-4111-8111-111111111111';

  function activeTurnSession(now: Date): DiscoveredSession {
    return createSessionWithPid({
      sessionId: SESSION_ID,
      lastActivity: new Date(now.getTime() - 10_000), // 10s ago — well inside relevanceHours
    });
  }

  it('a session written to in the last 60s is NOT finalized on the first poll', async () => {
    const now = new Date(2026, 8, 5, 19, 30, 5);
    const transcriptReader = new FakeTranscriptReader(
      new Map([
        [
          SESSION_ID,
          {
            facts: {
              lastActivity: new Date(now.getTime() - 10_000),
              lastPrompts: [],
              assistantMessages: [],
              touchedFiles: [],
            },
            rejected: [],
            unknownEntryTypeCount: 0,
          },
        ],
      ]),
    );
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }), { transcriptReader });
    await harness.poll(now, { sessions: [activeTurnSession(now)] });

    const state = await harness.storage.readState();
    expect(state?.endOfDayFired).toBe(false); // not finalized — still retrying
    expect(harness.notifier.notices).toStrictEqual([]); // no closure notice yet either
    // The handoff was still written (docs/ESPECIFICACAO.md: "captura assim mesmo e marca
    // capturedDuringActiveTurn: true") — endDay itself never withholds a capture.
    expect(await harness.storage.readHandoff('2026-09-05', SESSION_ID)).toMatchObject({
      capturedDuringActiveTurn: true,
    });
  });

  it('once the budget expires (5 minutes past the deadline), it finalizes even if still active', async () => {
    const deadline = new Date(2026, 8, 5, 19, 30, 0);
    const budgetExpired = new Date(deadline.getTime() + 5 * 60_000);
    const transcriptReader = new FakeTranscriptReader(
      new Map([
        [
          SESSION_ID,
          {
            facts: {
              lastActivity: new Date(budgetExpired.getTime() - 10_000),
              lastPrompts: [],
              assistantMessages: [],
              touchedFiles: [],
            },
            rejected: [],
            unknownEntryTypeCount: 0,
          },
        ],
      ]),
    );
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }), { transcriptReader });
    await harness.poll(budgetExpired, { sessions: [activeTurnSession(budgetExpired)] });

    const state = await harness.storage.readState();
    expect(state?.endOfDayFired).toBe(true);
    expect(harness.notifier.notices).toHaveLength(1);
  });
});

describe('pollOnce — non-model retry budget (Q-040 item 3)', () => {
  const SESSION_ID = '11111111-1111-4111-8111-111111111111';

  /**
   * The scenario this guards against, exactly as docs/PLANO-DE-ENTREGA.md's brief frames it: a
   * session that's BOTH still mid-turn (so the active-turn retry keeps calling `endDay` for it
   * every poll) AND whose model call is genuinely broken (so every one of those retries would
   * otherwise waste a real `claude -p` invocation for no benefit). `lastActivity` stays inside the
   * 60s active-turn window relative to `deadline` for every poll below — this test doesn't advance
   * the clock between polls, only what `core/capture-retry.ts` counts.
   */
  function stuckAndFailingSession(deadline: Date): DiscoveredSession {
    return createSessionWithPid({
      sessionId: SESSION_ID,
      lastActivity: new Date(deadline.getTime() - 10_000),
    });
  }

  it('stops calling the generator for an exhausted session, without ending sessions still under budget', async () => {
    const deadline = new Date(2026, 8, 5, 19, 30, 0);
    const session = stuckAndFailingSession(deadline);
    // Facts-level `lastActivity` (what `capturedDuringActiveTurn` actually checks,
    // `application/capture-session.ts`) has to say "recent" too, not just the DiscoveredSession's
    // own field — a transcript reader with an empty map (this describe block's other tests don't
    // need one) would otherwise answer `null`, which reads as "not active turn" (D-025).
    const transcriptReader = new FakeTranscriptReader(
      new Map([
        [
          SESSION_ID,
          {
            facts: {
              lastActivity: new Date(deadline.getTime() - 10_000),
              lastPrompts: [],
              assistantMessages: [],
              touchedFiles: [],
            },
            rejected: [],
            unknownEntryTypeCount: 0,
          },
        ],
      ]),
    );
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }), {
      leanGenerator: failingGenerator('model is down'),
      transcriptReader,
    });

    // Poll repeatedly (as the daemon would every 30s): the active-turn retry keeps the day from
    // finalizing, so every one of these actually reaches the generator — until the budget below.
    for (let i = 0; i < 3; i += 1) {
      await harness.poll(deadline, { sessions: [session] });
    }

    const stateAfterThree = await harness.storage.readState();
    expect(stateAfterThree?.captureAttemptsToday[SESSION_ID]).toBe(3);
    expect(stateAfterThree?.endOfDayFired).toBe(false); // still retrying, budget not yet checked

    // A 4th poll must NOT call the generator again for this now-exhausted session — proven with a
    // double that rejects the whole poll if it's ever invoked, not just asserting a call count.
    const explodingGenerator: HandoffGenerator = {
      generate: () => Promise.reject(new Error('should never be called — session is exhausted')),
    };
    const deps: DaemonDeps = {
      clock: clockAt(deadline),
      storage: harness.storage,
      notifier: harness.notifier,
      processControl: new ControllableProcessControl(),
      transcriptReader: new FakeTranscriptReader(),
      gitReader: new FakeGitReader(),
      forkCleanup: new FakeForkCleanup(),
      buildSessionProvider: () => new FakeSessionProvider({ sessions: [session], rejected: [] }),
      buildGenerators: () => ({
        leanGenerator: explodingGenerator,
        deepGenerator: explodingGenerator,
      }),
      discoverEarlyWarnings: () => Promise.resolve([]),
    };
    await expect(pollOnce(deps)).resolves.toBeUndefined();

    // With the only session excluded, nothing is "still active turn" this round — the day
    // finalizes instead of waiting out the rest of the 5-minute budget on a session that will
    // never succeed today.
    const finalState = await harness.storage.readState();
    expect(finalState?.endOfDayFired).toBe(true);
  });
});

describe('pollOnce — D-036 case 1: the local day rolled over before yesterday ever closed', () => {
  it('notifies once that the day cannot be redone, and never fires the stale schedule', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }));
    // Yesterday's DayState, exactly as a real daemon that never got to fire it would leave behind:
    // never fired, never skipped.
    await harness.storage.saveState(emptyDayState('2026-09-04'));

    // Well before TODAY's own 19:30 — proves this isn't "case 2/3" (same-day delay) sneaking in.
    await harness.poll(new Date(2026, 8, 5, 8, 0, 0), { sessions: [] });

    expect(harness.notifier.notices).toHaveLength(1);
    expect(harness.notifier.notices[0]?.title).toContain('2026-09-04');
    expect(harness.notifier.notices[0]?.body).toContain('no way to redo it');

    const state = await harness.storage.readState();
    expect(state?.day).toBe('2026-09-05');
    expect(state?.endOfDayFired).toBe(false); // today's own schedule is untouched, still pending

    // A second poll later the SAME day must not repeat the notice (D-018's "avisa uma vez").
    await harness.poll(new Date(2026, 8, 5, 9, 0, 0), { sessions: [] });
    expect(harness.notifier.notices).toHaveLength(1);
  });

  it('does not notify when yesterday actually closed on time before the day rolled over', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }));
    await harness.storage.saveState({ ...emptyDayState('2026-09-04'), endOfDayFired: true });

    await harness.poll(new Date(2026, 8, 5, 8, 0, 0), { sessions: [] });

    expect(harness.notifier.notices).toStrictEqual([]);
    expect((await harness.storage.readState())?.day).toBe('2026-09-05');
  });

  it('does not notify when yesterday was explicitly skipped (D-006 opt-out, not a miss)', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: '19:30' }));
    await harness.storage.saveState({ ...emptyDayState('2026-09-04'), skipped: true });

    await harness.poll(new Date(2026, 8, 5, 8, 0, 0), { sessions: [] });

    expect(harness.notifier.notices).toStrictEqual([]);
  });

  it('does not notify when the schedule is disabled (endOfDayTime: null)', async () => {
    const harness = buildHarness(createConfig({ endOfDayTime: null }));
    await harness.storage.saveState(emptyDayState('2026-09-04'));

    await harness.poll(new Date(2026, 8, 5, 8, 0, 0), { sessions: [] });

    expect(harness.notifier.notices).toStrictEqual([]);
  });
});

describe('pollOnce — S4-T12: captureModel/budgetPerSessionUsd are read fresh every poll', () => {
  const SESSION_ID = '11111111-1111-4111-8111-111111111111';

  /** Recent-but-not-active-turn activity relative to `now` — finalizes cleanly on the FIRST poll
   * for that day, the same shape `createConfig`'s D-036 tests above already use, so each poll below
   * reaches `buildGenerators` without the active-turn retry muddying which poll called it. */
  function finalizingSession(now: Date): DiscoveredSession {
    return createSessionWithPid({
      sessionId: SESSION_ID,
      lastActivity: new Date(now.getTime() - 10 * 60_000),
    });
  }

  function transcriptReaderFor(now: Date): FakeTranscriptReader {
    return new FakeTranscriptReader(
      new Map([
        [
          SESSION_ID,
          {
            facts: {
              lastActivity: new Date(now.getTime() - 10 * 60_000),
              lastPrompts: [],
              assistantMessages: [],
              touchedFiles: [],
            },
            rejected: [],
            unknownEntryTypeCount: 0,
          },
        ],
      ]),
    );
  }

  function buildDeps(
    storage: InMemoryDaemonStorage,
    notifier: RecordingNotifier,
    now: Date,
    generatorOptionsSeen: HandoffGeneratorOptionsLog,
  ): DaemonDeps {
    return {
      clock: clockAt(now),
      storage,
      notifier,
      processControl: new ControllableProcessControl(),
      transcriptReader: transcriptReaderFor(now),
      gitReader: new FakeGitReader(),
      forkCleanup: new FakeForkCleanup(),
      buildSessionProvider: () =>
        new FakeSessionProvider({ sessions: [finalizingSession(now)], rejected: [] }),
      buildGenerators: (options) => {
        generatorOptionsSeen.push(options);
        const generator = succeedingGenerator({
          understanding: '',
          pendingItems: [],
          tomorrowPlan: [],
        });
        return { leanGenerator: generator, deepGenerator: generator };
      },
      discoverEarlyWarnings: () => Promise.resolve([]),
    };
  }

  type HandoffGeneratorOptionsLog = Array<{ model: string; budgetPerSessionUsd: number }>;

  // The mantenedor's own scenario (docs/QUESTOES.md Q-049 item 8): `seeya config set captureModel`
  // (or `budgetPerSessionUsd`) while the daemon is already running, mid-day — before this task, the
  // daemon's generators were built ONCE at startup (`cli/composition.ts#buildDaemonContext`), so the
  // edit only took effect after a restart, unlike `relevanceHours` (already a per-poll closure).
  // Two different local DAYS (not just two `pollOnce` calls) so the second poll's capture is never
  // mistaken for D-026's anti-duplication of the first.
  it('a captureModel/budgetPerSessionUsd change made between two poll cycles applies on the very next one', async () => {
    const storage = new InMemoryDaemonStorage(
      createConfig({ endOfDayTime: '19:30', captureModel: 'sonnet', budgetPerSessionUsd: 0.25 }),
    );
    const notifier = new RecordingNotifier();
    const generatorOptionsSeen: HandoffGeneratorOptionsLog = [];

    const day1Now = new Date(2026, 8, 5, 19, 30, 5);
    await pollOnce(buildDeps(storage, notifier, day1Now, generatorOptionsSeen));
    expect(generatorOptionsSeen).toEqual([{ model: 'sonnet', budgetPerSessionUsd: 0.25 }]);
    expect((await storage.readState())?.endOfDayFired).toBe(true);

    // No daemon restart between cycles — just `seeya config set`, exactly like a real mid-day edit.
    const midDayConfig = await storage.readConfig();
    await storage.saveConfig({ ...midDayConfig, captureModel: 'opus', budgetPerSessionUsd: 0.5 });

    const day2Now = new Date(2026, 8, 6, 19, 30, 5);
    await pollOnce(buildDeps(storage, notifier, day2Now, generatorOptionsSeen));
    expect(generatorOptionsSeen).toEqual([
      { model: 'sonnet', budgetPerSessionUsd: 0.25 },
      { model: 'opus', budgetPerSessionUsd: 0.5 },
    ]);
  });
});

describe('pollOnce — D-036 case 2/3: same day, captures always, terminates only within the threshold', () => {
  const SESSION_ID = '11111111-1111-4111-8111-111111111111';
  const TERMINATABLE_CWD = 'c:\\code\\projeto';

  /** A session with recent-but-not-active-turn activity, so it captures cleanly on the FIRST poll —
   * no active-turn retry muddying whether termination ran because of D-036 or because a retry
   * hadn't finished yet. */
  function terminatableSession(now: Date): DiscoveredSession {
    return createSessionWithPid({
      sessionId: SESSION_ID,
      cwd: TERMINATABLE_CWD,
      lastActivity: new Date(now.getTime() - 10 * 60_000), // 10 minutes ago — outside the 60s window
    });
  }

  function transcriptReaderFor(now: Date): FakeTranscriptReader {
    return new FakeTranscriptReader(
      new Map([
        [
          SESSION_ID,
          {
            facts: {
              lastActivity: new Date(now.getTime() - 10 * 60_000),
              lastPrompts: [],
              assistantMessages: [],
              touchedFiles: [],
            },
            rejected: [],
            unknownEntryTypeCount: 0,
          },
        ],
      ]),
    );
  }

  /** `terminateGracefully` throws if it's ever called — a stronger proof than a call counter that
   * D-036's overdue path never even attempts termination, the same "exploding double" pattern the
   * non-model-retry-budget test above already uses for its own "must never be called" assertion. */
  class ExplodingProcessControl implements ProcessControl {
    isAlive(): Promise<boolean> {
      return Promise.resolve(true);
    }
    terminateGracefully(): Promise<boolean> {
      throw new Error('D-036: must not terminate a session on an overdue, same-day close');
    }
  }

  it('THE test that protects real work: overdue past the threshold captures but does NOT terminate, even with canTerminate: true', async () => {
    const config = createConfig({
      endOfDayTime: '19:30',
      overdueFireThresholdMinutes: 5,
      projectPolicy: { [TERMINATABLE_CWD]: { canTerminate: true, deepCapture: false } },
    });
    const wokeUpLate = new Date(2026, 8, 5, 19, 45, 0); // 15 minutes past 19:30 — well past 5
    const harness = buildHarness(config, {
      transcriptReader: transcriptReaderFor(wokeUpLate),
      processControl: new ExplodingProcessControl(),
    });

    await harness.poll(wokeUpLate, { sessions: [terminatableSession(wokeUpLate)] });

    // The handoff still exists — capture happened normally (D-036: "captura, mas NÃO encerra").
    const handoff = await harness.storage.readHandoff('2026-09-05', SESSION_ID);
    expect(handoff).not.toBeNull();

    const state = await harness.storage.readState();
    expect(state?.endOfDayFired).toBe(true);

    expect(harness.notifier.notices).toHaveLength(1);
    expect(harness.notifier.notices[0]?.title).toContain('delayed');
    expect(harness.notifier.notices[0]?.body).toContain('no session was terminated');
    // ExplodingProcessControl never threw — pollOnce resolved above without rejecting — proving
    // terminateGracefully was genuinely never invoked, not just that its result was discarded.
  });

  it('within the threshold: captures AND terminates normally, same canTerminate: true session', async () => {
    const config = createConfig({
      endOfDayTime: '19:30',
      overdueFireThresholdMinutes: 5,
      projectPolicy: { [TERMINATABLE_CWD]: { canTerminate: true, deepCapture: false } },
    });
    const justAfter = new Date(2026, 8, 5, 19, 30, 5); // 5s past — ordinary poll jitter, well under 5min
    let terminateCalledWith: number | null = null;
    const processControl: ProcessControl = {
      isAlive: () => Promise.resolve(true),
      terminateGracefully: (pid: number) => {
        terminateCalledWith = pid;
        return Promise.resolve(true);
      },
    };
    const harness = buildHarness(config, {
      transcriptReader: transcriptReaderFor(justAfter),
      processControl,
    });

    await harness.poll(justAfter, { sessions: [terminatableSession(justAfter)] });

    expect(terminateCalledWith).toBe(4242); // createSessionWithPid's own default pid
    expect(harness.notifier.notices[0]?.title).not.toContain('delayed');
    expect(harness.notifier.notices[0]?.body).not.toContain('no session was terminated');
  });
});
