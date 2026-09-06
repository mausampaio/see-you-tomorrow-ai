/**
 * `scheduler/health.ts` (S4-T3b) — wires `core/daemon-health.ts`'s pure decision to `Storage`/
 * `Notifier`/`Clock`. `tests/unit/scheduler/loop.test.ts` already exercises this through the real
 * `runDaemon` loop; this file tests the wiring directly, including the two things that loop-level
 * test can't easily isolate: a non-`Error` throw, and the "nothing to write" fast path.
 */
import { describe, expect, it } from 'vitest';
import { recordPollFailure, recordPollSuccess } from '../../../src/scheduler/health.js';
import { NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES } from '../../../src/core/daemon-health.js';
import { createConfig } from '../core/_fixtures.js';
import {
  FakeForkCleanup,
  FakeGitReader,
  FakeTranscriptReader,
  succeedingGenerator,
} from '../application/_fakes.js';
import { ControllableProcessControl, InMemoryDaemonStorage, RecordingNotifier } from './_fakes.js';
import type { DaemonDeps } from '../../../src/scheduler/types.js';

const NOW = new Date('2026-09-05T10:00:00.000Z');

function buildDeps(overrides: Partial<DaemonDeps> = {}): DaemonDeps {
  return {
    clock: { now: () => NOW, sleep: () => Promise.resolve() },
    storage: new InMemoryDaemonStorage(createConfig()),
    notifier: new RecordingNotifier(),
    processControl: new ControllableProcessControl(),
    transcriptReader: new FakeTranscriptReader(),
    gitReader: new FakeGitReader(),
    leanGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    deepGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    forkCleanup: new FakeForkCleanup(),
    buildSessionProvider: () => ({ list: () => Promise.reject(new Error('not exercised')) }),
    discoverEarlyWarnings: () => Promise.resolve([]),
    ...overrides,
  };
}

describe('recordPollFailure', () => {
  it('on a machine that has never run a poll, starts a fresh streak at 1', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const deps = buildDeps({ storage });

    await recordPollFailure(deps, new Error('ECONNREFUSED'));

    const state = await storage.readState();
    expect(state?.daemonHealth).toStrictEqual({
      lastCycleError: { message: 'ECONNREFUSED', at: NOW },
      consecutiveCycleFailures: 1,
    });
  });

  it('a non-Error throw is still described with a real string (AGENTS.md: never just "it failed")', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const deps = buildDeps({ storage });

    await recordPollFailure(deps, 'a bare string throw');

    const state = await storage.readState();
    expect(state?.daemonHealth.lastCycleError?.message).toBe('a bare string throw');
  });

  it('propagates a Storage failure instead of swallowing it — scheduler/loop.ts is what makes this best-effort, via its own .catch() at the call site', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    storage.saveState = () => Promise.reject(new Error('disk full'));
    const deps = buildDeps({ storage });

    await expect(recordPollFailure(deps, new Error('boom'))).rejects.toThrow('disk full');
  });

  it('notifies exactly on the threshold-crossing call, not before', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const notifier = new RecordingNotifier();
    const deps = buildDeps({ storage, notifier });

    // Sequential by design: each call must see the PREVIOUS one's persisted state, the same way
    // scheduler/loop.ts calls this in series (never concurrently).
    for (let i = 0; i < NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES - 1; i += 1) {
      await recordPollFailure(deps, new Error('still broken'));
    }
    expect(notifier.notices).toHaveLength(0);

    await recordPollFailure(deps, new Error('still broken'));
    expect(notifier.notices).toHaveLength(1);
    expect(notifier.notices[0]?.title).toBe('seeya: daemon is stuck');
  });
});

describe('recordPollSuccess', () => {
  it('writes nothing on a machine that has never failed (no-op fast path)', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const deps = buildDeps({ storage });

    await recordPollSuccess(deps);

    expect(await storage.readState()).toBeNull();
  });

  it('clears a recorded failure streak', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const deps = buildDeps({ storage });
    await recordPollFailure(deps, new Error('boom'));

    await recordPollSuccess(deps);

    const state = await storage.readState();
    expect(state?.daemonHealth).toStrictEqual({
      lastCycleError: null,
      consecutiveCycleFailures: 0,
    });
  });
});
