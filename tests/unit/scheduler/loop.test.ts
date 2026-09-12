/**
 * `scheduler/loop.ts` (S4-T3). `maxIterations`/`shouldStop` are the test-only seams that make an
 * otherwise-infinite loop finite (see that file's own docstring) — real production code never sets
 * either.
 */
import { describe, expect, it } from 'vitest';
import { runDaemon } from '../../../src/scheduler/loop.js';
import { createConfig } from '../core/_fixtures.js';
import {
  FakeForkCleanup,
  FakeGitReader,
  FakeSessionProvider,
  FakeTranscriptReader,
  succeedingGenerator,
} from '../application/_fakes.js';
import { ControllableProcessControl, InMemoryDaemonStorage, RecordingNotifier } from './_fakes.js';
import type { DaemonDeps } from '../../../src/scheduler/types.js';
import { NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES } from '../../../src/core/daemon-health.js';

const NOW = new Date(2026, 8, 5, 8, 0, 0); // long before any lead time — every poll is a no-op

function buildDeps(overrides: Partial<DaemonDeps> = {}): DaemonDeps {
  return {
    clock: { now: () => NOW, sleep: () => Promise.resolve() },
    storage: new InMemoryDaemonStorage(createConfig()),
    notifier: new RecordingNotifier(),
    processControl: new ControllableProcessControl(),
    transcriptReader: new FakeTranscriptReader(),
    gitReader: new FakeGitReader(),
    forkCleanup: new FakeForkCleanup(),
    buildSessionProvider: () => new FakeSessionProvider({ sessions: [], rejected: [] }),
    buildGenerators: () => ({
      leanGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
      deepGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    }),
    discoverEarlyWarnings: () => Promise.resolve([]),
    ...overrides,
  };
}

describe('runDaemon — single instance (D-005)', () => {
  it('refuses and never polls when another instance already holds a live lock', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    await storage.writeDaemonLock({ pid: 4242, startedAt: NOW, procStart: undefined });
    const processControl = new ControllableProcessControl(new Map([[4242, true]]));
    // A `discoverEarlyWarnings` that throws if ever called proves no poll happened at all — a
    // stronger assertion than counting calls after the fact.
    const deps = buildDeps({
      storage,
      processControl,
      discoverEarlyWarnings: () => Promise.reject(new Error('must not poll — lock refused')),
    });

    const outcome = await runDaemon(deps, 555, undefined, { maxIterations: 1 });
    expect(outcome).toStrictEqual({ kind: 'alreadyRunning', heldByPid: 4242 });
  });

  it('acquires the lock (writes its own pid) when the existing one is stale', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    await storage.writeDaemonLock({ pid: 4242, startedAt: NOW, procStart: undefined });
    const processControl = new ControllableProcessControl(new Map([[4242, false]]));
    const deps = buildDeps({ storage, processControl });

    const outcome = await runDaemon(deps, 555, undefined, { maxIterations: 1 });
    expect(outcome).toStrictEqual({ kind: 'stopped' });
  });
});

describe('runDaemon — the loop itself', () => {
  it('polls exactly `maxIterations` times, sleeping between each', async () => {
    // S4-T5: the wait between polls is chunked into 1s pieces (`sleepUntilNextPollOrStop`) so a
    // `--stop` request lands quickly instead of waiting out a single 30s sleep — so each of the
    // gaps between polls below now costs POLL_INTERVAL_MS / 1_000 = 30 `Clock.sleep` calls, not 1.
    // `shouldStop` is never set here, so every chunk actually runs (no early return).
    const CHUNKS_PER_GAP = 30;
    let pollCount = 0;
    let sleepCount = 0;
    const deps = buildDeps({
      clock: {
        now: () => NOW,
        sleep: () => {
          sleepCount += 1;
          return Promise.resolve();
        },
      },
      discoverEarlyWarnings: () => {
        pollCount += 1;
        return Promise.resolve([]);
      },
    });

    await runDaemon(deps, 555, undefined, { maxIterations: 3 });
    expect(pollCount).toBe(3);
    expect(sleepCount).toBe(2 * CHUNKS_PER_GAP); // sleeps BETWEEN polls, never after the last one
  });

  it('a shouldStop that flips true mid-wait is noticed within one chunk, not a full 30s sleep', async () => {
    // The whole point of S4-T5's chunking: `seeya daemon --stop` sets this flag asynchronously
    // (a real SIGTERM handler), and the loop must not need to finish a full POLL_INTERVAL_MS sleep
    // to notice it. Flips true after the 2nd `Clock.sleep` call within the wait — proving the loop
    // checks `shouldStop` BETWEEN chunks, not only before/after the whole wait.
    let sleepCalls = 0;
    let stopFlag = false;
    const deps = buildDeps({
      clock: {
        now: () => NOW,
        sleep: () => {
          sleepCalls += 1;
          if (sleepCalls === 2) {
            stopFlag = true;
          }
          return Promise.resolve();
        },
      },
    });

    await runDaemon(deps, 555, undefined, { shouldStop: () => stopFlag });
    // 2 chunks spent waiting, then the 3rd check (before what would be the next chunk) sees the
    // flag and returns early — nowhere near the 30 chunks a full, un-chunked wait would need.
    expect(sleepCalls).toBe(2);
  });

  it('a poll that throws does not stop the loop (docs/PLANO-DE-ENTREGA.md: "o perigo que só existe em laço")', async () => {
    let attempt = 0;
    const deps = buildDeps({
      discoverEarlyWarnings: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error('transient failure'));
        }
        return Promise.resolve([]);
      },
    });

    const outcome = await runDaemon(deps, 555, undefined, { maxIterations: 2 });
    expect(outcome).toStrictEqual({ kind: 'stopped' });
    expect(attempt).toBe(2); // the second poll still ran despite the first one throwing
  });

  it('shouldStop is honored between cycles, and clears the lock on a clean stop', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    let calls = 0;
    const deps = buildDeps({
      storage,
      discoverEarlyWarnings: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    });

    await runDaemon(deps, 555, undefined, { shouldStop: () => calls >= 2 });
    expect(calls).toBe(2);
    expect(await storage.readDaemonLock()).toBeNull();
  });
});

describe('runDaemon — daemon health tracking (S4-T3b)', () => {
  it('a poll that throws records the error and a growing consecutive-failure count in estado.json', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const deps = buildDeps({
      storage,
      discoverEarlyWarnings: () => Promise.reject(new Error('boom')),
    });

    await runDaemon(deps, 555, undefined, { maxIterations: 3 });

    const state = await storage.readState();
    expect(state?.daemonHealth.consecutiveCycleFailures).toBe(3);
    expect(state?.daemonHealth.lastCycleError?.message).toBe('boom');
  });

  it('a successful poll after failures clears the streak entirely', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    let attempt = 0;
    const deps = buildDeps({
      storage,
      discoverEarlyWarnings: () => {
        attempt += 1;
        if (attempt <= 2) {
          return Promise.reject(new Error('transient'));
        }
        return Promise.resolve([]);
      },
    });

    await runDaemon(deps, 555, undefined, { maxIterations: 3 });

    const state = await storage.readState();
    expect(state?.daemonHealth).toStrictEqual({
      lastCycleError: null,
      consecutiveCycleFailures: 0,
    });
  });

  it('notifies exactly once, on the poll that crosses the threshold — never before, never again after', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const notifier = new RecordingNotifier();
    const deps = buildDeps({
      storage,
      notifier,
      discoverEarlyWarnings: () => Promise.reject(new Error('stuck')),
    });

    await runDaemon(deps, 555, undefined, {
      maxIterations: NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES + 5,
    });

    const unhealthyNotices = notifier.notices.filter((n) => n.title === 'seeya: daemon is stuck');
    expect(unhealthyNotices).toHaveLength(1);
  });

  it('the loop survives even when recording the failure ALSO fails (double failure, still no crash)', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    storage.saveState = () => Promise.reject(new Error('disk full while recording health'));
    let attempts = 0;
    const deps = buildDeps({
      storage,
      discoverEarlyWarnings: () => {
        attempts += 1;
        return Promise.reject(new Error('original poll failure'));
      },
    });

    const outcome = await runDaemon(deps, 555, undefined, { maxIterations: 3 });

    expect(outcome).toStrictEqual({ kind: 'stopped' });
    expect(attempts).toBe(3); // every poll still ran, despite BOTH failures each cycle
  });

  it('an all-healthy run never writes estado.json at all — no needless disk activity', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const deps = buildDeps({ storage });

    // NOW is long before any lead time (top of file) — every poll decides 'waiting', which
    // scheduler/poll.ts's own quiet branch never persists either.
    await runDaemon(deps, 555, undefined, { maxIterations: 3 });

    expect(await storage.readState()).toBeNull();
  });
});
