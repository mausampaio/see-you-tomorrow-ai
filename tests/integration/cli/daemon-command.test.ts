/**
 * `cli/daemon-command.ts#runDaemonLauncher`'s REAL spawn path — the one
 * `tests/unit/cli/daemon-command.test.ts` deliberately leaves uncovered (that file only exercises
 * the "already running" refusal, which never spawns anything). Reuses
 * `tests/fixtures/process/graceful-child.mjs` as the launch target, same as
 * `tests/integration/process/daemon-launch.test.ts` — this file's own job is proving
 * `runDaemonLauncher` calls that machinery correctly and reports a sensible message, not
 * re-measuring `spawnDetachedDaemon` itself.
 */
import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runDaemonLauncher,
  runDaemonStatus,
  runDaemonStop,
  type DaemonControlDeps,
} from '../../../src/cli/daemon-command.js';
import { checkDaemonLock } from '../../../src/scheduler/index.js';
import { processExists } from '../../../src/adapters/process/existence.js';
import { processControl } from '../../../src/adapters/process/index.js';
import { captureObservedProcStart } from '../../../src/adapters/process/proc-start.js';
import { DEFAULT_TEST_CONFIG, FakeStorage } from '../../unit/application/_fakes.js';
import { InMemoryDaemonStorage } from '../../unit/scheduler/_fakes.js';
import type { DaemonLockInfo } from '../../../src/core/daemon-lock.js';
import type { ProcessControl } from '../../../src/core/ports.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../fixtures/process/graceful-child.mjs', import.meta.url),
);

class NoLockStorage extends FakeStorage {
  override readDaemonLock(): Promise<DaemonLockInfo | null> {
    return Promise.resolve(null);
  }
}

class UnusedProcessControl implements ProcessControl {
  isAlive(): Promise<boolean> {
    return Promise.reject(new Error('not exercised — nothing to check, no lock exists'));
  }
  terminateGracefully(): Promise<boolean> {
    return Promise.reject(new Error('not exercised'));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await readFile(filePath, 'utf8');
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`${filePath} never appeared within ${timeoutMs}ms`);
      }
      await sleep(20);
    }
  }
}

describe('runDaemonLauncher — real spawn path', () => {
  it('spawns the worker for real and reports its pid, with no lock in the way', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'seeya-daemon-command-'));
    const readyMarker = path.join(tmp, 'ready.marker');
    const shutdownMarker = path.join(tmp, 'shutdown.marker');
    let pidFromMessage: number | undefined;
    try {
      const message = await runDaemonLauncher(
        new NoLockStorage(DEFAULT_TEST_CONFIG),
        new UnusedProcessControl(),
        {
          scriptPath: FIXTURE_PATH,
          args: [shutdownMarker, readyMarker],
        },
      );

      expect(message).toContain('seeya daemon started');
      expect(message).toMatch(/pid \d+/);
      pidFromMessage = Number(/pid (\d+)/.exec(message)?.[1]);
      expect(Number.isInteger(pidFromMessage)).toBe(true);

      await waitForFile(readyMarker, 5_000);
      expect(await processExists(pidFromMessage)).toBe(true);
    } finally {
      if (pidFromMessage !== undefined) {
        try {
          process.kill(pidFromMessage, 'SIGTERM');
        } catch {
          // Already gone.
        }
      }
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// S4-T5: `runDaemonStop`/`runDaemonStatus` against a REAL process and the REAL `ProcessControl`
// (`adapters/process/index.js`) — the same rigor `tests/integration/process/daemon-launch.test.ts`
// already applies to the launch side. `graceful-child.mjs` stands in for the daemon worker: this
// file's own job is proving `runDaemonStop`/`runDaemonStatus` drive the real mechanisms correctly,
// not re-measuring `terminateGracefully`/`terminateAbruptly` themselves (already covered in
// `tests/integration/process/termination.test.ts`).
// ---------------------------------------------------------------------------------------------

async function markerExists(marker: string): Promise<boolean> {
  return readFile(marker, 'utf8').then(
    () => true,
    () => false,
  );
}

async function realProcStart(pid: number): Promise<string> {
  const capture = await captureObservedProcStart(pid, processExists);
  if (capture.kind !== 'value') {
    throw new Error(
      `expected a real procStart capture for pid ${pid}, got ${JSON.stringify(capture)}`,
    );
  }
  return capture.value;
}

/** A `Clock` that never starts a real timer for `now()`/`sleep()` is fine here EXCEPT on the
 * abrupt-stop path (`waitUntilDead` in `cli/daemon-command.ts` really does need real elapsed time
 * between re-checking a real OS process) — so this one actually waits for real. `now()` staying
 * fixed is harmless: nothing in `runDaemonStop`/`runDaemonStatus`'s own logic reads it except
 * `--status`'s schedule section, not under test in the stop-focused blocks below. */
function realWaitClock(): DaemonControlDeps['clock'] {
  return {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

interface RealDaemonFixture {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly shutdownMarker: string;
  readonly storage: InMemoryDaemonStorage;
  readonly deps: DaemonControlDeps;
  readonly cleanup: () => Promise<void>;
}

/** Spawns a real `graceful-child.mjs`, waits for it to be ready, and writes a real daemon lock
 * pointing at it (real `pid` + real `procStart`, S4-T3b's own tie-break) — the exact shape
 * `cli/index.ts` writes for a real worker, minus actually being one. */
async function setUpRealDaemonFixture(): Promise<RealDaemonFixture> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'seeya-daemon-stop-'));
  const shutdownMarker = path.join(tmp, 'shutdown.marker');
  const readyMarker = path.join(tmp, 'ready.marker');
  const child = spawn(process.execPath, [FIXTURE_PATH, shutdownMarker, readyMarker], {
    stdio: 'ignore',
  });
  await waitForFile(readyMarker, 5_000);
  const pid = child.pid as number;
  const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
  await storage.writeDaemonLock({
    pid,
    startedAt: new Date(),
    procStart: await realProcStart(pid),
  });
  const deps: DaemonControlDeps = { storage, processControl, clock: realWaitClock() };
  const cleanup = async (): Promise<void> => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone — test cleanup, not the product's own path.
    }
    await rm(tmp, { recursive: true, force: true });
  };
  return { child, pid, shutdownMarker, storage, deps, cleanup };
}

describe.skipIf(process.platform === 'win32')(
  'runDaemonStop — real graceful stop (POSIX: real SIGTERM)',
  () => {
    it(
      'sends a real SIGTERM, the child runs its own shutdown handler, and the lock is cleared ' +
        '— the next daemon start would succeed',
      async () => {
        const fixture = await setUpRealDaemonFixture();
        try {
          const report = await runDaemonStop(fixture.deps, 'linux');

          expect(report).toBe(`Stopped the daemon (pid ${fixture.pid}) gracefully.`);
          expect(await markerExists(fixture.shutdownMarker)).toBe(true); // ran its own handler
          expect(await fixture.storage.readDaemonLock()).toBeNull();
          const nextStart = await checkDaemonLock(fixture.storage, processControl);
          expect(nextStart).toStrictEqual({ kind: 'acquire' });
        } finally {
          await fixture.cleanup();
        }
      },
      20_000, // real SIGTERM to a fixture that responds almost immediately — generous, not tight
    );
  },
);

describe('runDaemonStop — real abrupt stop (forced platform: win32)', () => {
  it(
    'never runs the shutdown handler (no graceful path exists for a console-less Windows ' +
      'daemon, D-005) but still confirms death and clears the lock',
    async () => {
      const fixture = await setUpRealDaemonFixture();
      try {
        // Forcing 'win32' regardless of the host OS exercises the BRANCH SELECTION (go straight
        // to `terminateAbruptly`, never try `terminateGracefully` first) portably — the OS call
        // underneath (`SIGKILL` here vs `TerminateProcess` on real Windows) differs, but the claim
        // under test — "abrupt, handler never runs, still confirmed dead, lock cleared" — holds
        // identically either way (see this file's own report for what remains platform-specific
        // and therefore unverified on this host).
        const report = await runDaemonStop(fixture.deps, 'win32');

        expect(report).toContain(`Stopped the daemon (pid ${fixture.pid})`);
        expect(report).toContain('stopped abruptly');
        expect(await markerExists(fixture.shutdownMarker)).toBe(false); // handler never ran
        expect(await fixture.storage.readDaemonLock()).toBeNull();
        await expect(processControl.isAlive(fixture.pid)).resolves.toBe(false);
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

describe('runDaemonStop — a lock pointing at an already-dead pid', () => {
  it('is reported as nothing to stop, and the stale lock is cleared either way', async () => {
    const fixture = await setUpRealDaemonFixture();
    fixture.child.kill('SIGKILL');
    await new Promise<void>((resolve) => fixture.child.once('exit', () => resolve()));
    try {
      const report = await runDaemonStop(fixture.deps);

      expect(report).toContain('No daemon is running');
      expect(report).toContain('the stale lock was cleared');
      expect(await fixture.storage.readDaemonLock()).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('runDaemonStatus — against a real process', () => {
  it('reports "running" for a live daemon and "not running" once it is gone', async () => {
    const fixture = await setUpRealDaemonFixture();
    try {
      const whileAlive = await runDaemonStatus(fixture.deps);
      expect(whileAlive).toContain(`Daemon: running (pid ${fixture.pid}`);

      fixture.child.kill('SIGKILL');
      await new Promise<void>((resolve) => fixture.child.once('exit', () => resolve()));

      const afterDeath = await runDaemonStatus(fixture.deps);
      expect(afterDeath).toContain('Daemon: not running (a stale lock file');
      // Read-only, unlike `runDaemonStop` above — status never clears anything itself.
      expect(await fixture.storage.readDaemonLock()).not.toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });
});
