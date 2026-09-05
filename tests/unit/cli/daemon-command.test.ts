/**
 * `cli/daemon-command.ts` (S4-T3). `runDaemonLauncher`'s "already running" path and
 * `runDaemonWorker`'s lock-refusal/signal-stop paths are both deterministic without ever spawning a
 * real process — the "started" launcher path (which DOES spawn for real) is covered instead by
 * `tests/integration/cli/daemon-command.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { runDaemonWorker, runDaemonLauncher } from '../../../src/cli/daemon-command.js';
import type { DaemonDeps } from '../../../src/scheduler/index.js';
import type { DaemonLockInfo } from '../../../src/core/daemon-lock.js';
import type { ProcessControl, Storage } from '../../../src/core/ports.js';
import {
  DEFAULT_TEST_CONFIG,
  FakeForkCleanup,
  FakeGitReader,
  FakeStorage,
  FakeTranscriptReader,
  failingGenerator,
} from '../application/_fakes.js';

/** Minimal named `Storage` double for this file's own two tests — only the daemon-lock methods a
 * real `runDaemonLauncher`/`runDaemonWorker` call actually touch. */
class LockOnlyStorage extends FakeStorage {
  private lock: DaemonLockInfo | null = null;

  override readDaemonLock(): Promise<DaemonLockInfo | null> {
    return Promise.resolve(this.lock);
  }

  override writeDaemonLock(lock: DaemonLockInfo): Promise<void> {
    this.lock = lock;
    return Promise.resolve();
  }

  override clearDaemonLock(): Promise<void> {
    this.lock = null;
    return Promise.resolve();
  }

  seedLock(lock: DaemonLockInfo): void {
    this.lock = lock;
  }
}

class FixedAliveness implements ProcessControl {
  constructor(private readonly alive: boolean) {}
  isAlive(): Promise<boolean> {
    return Promise.resolve(this.alive);
  }
  terminateGracefully(): Promise<boolean> {
    return Promise.reject(new Error('not exercised'));
  }
}

describe('runDaemonLauncher — refuse path (no spawn)', () => {
  it('reports the pid already holding the lock and never spawns anything', async () => {
    const storage: Storage = new LockOnlyStorage(DEFAULT_TEST_CONFIG);
    (storage as LockOnlyStorage).seedLock({
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const processControl = new FixedAliveness(true);

    const message = await runDaemonLauncher(storage, processControl, {
      scriptPath: '/nonexistent/should-not-be-spawned.js',
      args: ['daemon'],
    });

    expect(message).toContain('already running');
    expect(message).toContain('4242');
  });
});

describe('runDaemonWorker', () => {
  function buildDeps(storage: Storage, processControl: ProcessControl): DaemonDeps {
    return {
      clock: { now: () => new Date('2026-09-05T10:00:00.000Z'), sleep: () => Promise.resolve() },
      storage,
      notifier: { notify: () => Promise.resolve() },
      processControl,
      transcriptReader: new FakeTranscriptReader(),
      gitReader: new FakeGitReader(),
      leanGenerator: failingGenerator('not exercised by either test in this file'),
      deepGenerator: failingGenerator('not exercised by either test in this file'),
      forkCleanup: new FakeForkCleanup(),
      buildSessionProvider: () => ({ list: () => Promise.reject(new Error('not exercised')) }),
      discoverEarlyWarnings: () =>
        Promise.reject(new Error('not exercised — the lock check must win first')),
    };
  }

  it('returns exit code 1 when another instance already holds a live lock — never polls', async () => {
    const storage = new LockOnlyStorage(DEFAULT_TEST_CONFIG);
    storage.seedLock({ pid: 4242, startedAt: new Date('2026-09-01T00:00:00.000Z') });
    const deps = buildDeps(storage, new FixedAliveness(true));

    const exitCode = await runDaemonWorker(deps, 555);
    expect(exitCode).toBe(1);
  });

  it('a SIGTERM registered before the loop starts stops it before any poll runs (exit code 0)', async () => {
    const storage = new LockOnlyStorage(DEFAULT_TEST_CONFIG);
    const deps = buildDeps(storage, new FixedAliveness(false));

    // `runDaemonWorker` registers its SIGINT/SIGTERM listeners SYNCHRONOUSLY, before its first
    // `await` (`scheduler/lock.ts#acquireDaemonLock`'s own I/O) — emitting the signal in this same
    // synchronous tick, right after calling the function, is what makes this deterministic instead
    // of racing a real timer. `discoverEarlyWarnings` above rejects the whole poll if ever called,
    // so a passing test here also proves zero polls ran, not just an exit code.
    const resultPromise = runDaemonWorker(deps, 555);
    process.emit('SIGTERM');
    const exitCode = await resultPromise;

    expect(exitCode).toBe(0);
    expect(await storage.readDaemonLock()).toBeNull(); // lock cleared on the clean stop
  });
});
