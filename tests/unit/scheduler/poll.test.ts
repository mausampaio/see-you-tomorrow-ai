/**
 * `scheduler/poll.ts` (S4-T3) — one full daemon poll cycle. Exercises the real
 * `application/endDay` pipeline (not mocked away) so the active-turn retry and non-model retry
 * budget are proven against the actual capture flow, not a stand-in for it.
 */
import { describe, expect, it } from 'vitest';
import { pollOnce } from '../../../src/scheduler/poll.js';
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
    readonly leanGenerator?: DaemonDeps['leanGenerator'];
    readonly earlyWarnings?: readonly EarlyWarning[];
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
      processControl: new ControllableProcessControl(),
      transcriptReader: options.transcriptReader ?? new FakeTranscriptReader(),
      gitReader: new FakeGitReader(),
      leanGenerator:
        options.leanGenerator ??
        succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
      deepGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
      forkCleanup: new FakeForkCleanup(),
      buildSessionProvider: () =>
        new FakeSessionProvider({ sessions: [...(pollOptions.sessions ?? [])], rejected: [] }),
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
    expect(harness.notifier.notices[0]?.body).toBe(warning.message);
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
    const explodingGenerator: DaemonDeps['leanGenerator'] = {
      generate: () => Promise.reject(new Error('should never be called — session is exhausted')),
    };
    const deps: DaemonDeps = {
      clock: clockAt(deadline),
      storage: harness.storage,
      notifier: harness.notifier,
      processControl: new ControllableProcessControl(),
      transcriptReader: new FakeTranscriptReader(),
      gitReader: new FakeGitReader(),
      leanGenerator: explodingGenerator,
      deepGenerator: explodingGenerator,
      forkCleanup: new FakeForkCleanup(),
      buildSessionProvider: () => new FakeSessionProvider({ sessions: [session], rejected: [] }),
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
