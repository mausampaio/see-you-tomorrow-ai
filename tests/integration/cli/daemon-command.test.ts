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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDaemonLauncher } from '../../../src/cli/daemon-command.js';
import { processExists } from '../../../src/adapters/process/existence.js';
import { DEFAULT_TEST_CONFIG, FakeStorage } from '../../unit/application/_fakes.js';
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
