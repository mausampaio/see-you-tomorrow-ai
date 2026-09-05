/**
 * `adapters/process/daemon-launch.ts#spawnDetachedDaemon` (S4-T3, D-005) against a REAL child
 * process — reusing `tests/fixtures/process/graceful-child.mjs` (S1-T2's own fixture) rather than a
 * new one: it already does exactly what this test needs (stay alive, signal a marker file when its
 * handlers are registered, react to SIGTERM), and it's the one already excluded from
 * `verificar-termos-locais`'s scan the same way every fixture is.
 *
 * **What this test proves, and what it does NOT.** It proves the spawned process is real, alive,
 * and independently signalable (a normal OS process, not something broken by `detached`/`stdio:
 * 'ignore'`). It does NOT prove the process outlives the test runner's OWN process — that would
 * require the test process itself to exit and something else to check afterward, which no
 * automated test in this suite can do to itself. See this task's own report for the SEPARATE manual
 * verification (spinning up the real CLI in one shell invocation, checking the child from another)
 * that this in-process test structurally cannot cover.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAEMON_CHILD_ENV_VAR,
  spawnDetachedDaemon,
} from '../../../src/adapters/process/daemon-launch.js';
import { processExists } from '../../../src/adapters/process/existence.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../fixtures/process/graceful-child.mjs', import.meta.url),
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls for `filePath` to exist, up to a bound — the same race `graceful-child.mjs`'s own top
 * comment documents (a signal/check sent before the child finishes registering its handlers would
 * otherwise race real process startup). */
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

describe('spawnDetachedDaemon', () => {
  it('resolves with a real, live pid, detached and unreferenced', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'seeya-daemon-launch-'));
    const shutdownMarker = path.join(tmp, 'shutdown.marker');
    const readyMarker = path.join(tmp, 'ready.marker');
    try {
      const pid = await spawnDetachedDaemon({
        scriptPath: FIXTURE_PATH,
        args: [shutdownMarker, readyMarker],
      });
      expect(Number.isInteger(pid)).toBe(true);
      expect(pid).toBeGreaterThan(0);

      await waitForFile(readyMarker, 5_000);
      // Alive — detachment/`stdio: 'ignore'` did not break it into something the OS can't even
      // find (which would be indistinguishable, from the outside, from it never having started).
      expect(await processExists(pid)).toBe(true);

      // Cleanup only from here — NOT a proof of graceful shutdown. `process.kill(pid, 'SIGTERM')`
      // from a DIFFERENT process is a real signal on POSIX (the fixture's own handler runs,
      // writing `shutdownMarker` — measured directly while writing this test) but on Windows
      // Node has no true cross-process SIGTERM: `process.kill` there calls `TerminateProcess`
      // outright, same as `docs/spikes/G-ctrl-break-no-windows.md` already found for this exact
      // reason (that spike is WHY `adapters/process/termination-windows.ts` exists at all instead
      // of a plain `SIGTERM`). This test only needs the process gone afterward, on every OS — the
      // graceful-shutdown mechanism itself is `termination.test.ts`'s job, not this file's.
      process.kill(pid, 'SIGTERM');
      const deadline = Date.now() + 5_000;
      while (await processExists(pid)) {
        if (Date.now() > deadline) {
          throw new Error(`pid ${pid} was still alive 5s after being asked to terminate`);
        }
        await sleep(50);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('sets the DAEMON_CHILD_ENV_VAR on the child so it can tell it is the worker, not a fresh human invocation', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'seeya-daemon-launch-env-'));
    const readyMarker = path.join(tmp, 'ready.marker');
    // A tiny inline script (not the shared fixture) that just reports the env var back via a file
    // — this test is specifically about daemon-launch.ts's OWN env wiring, unrelated to
    // graceful-child.mjs's signal-handling concern.
    const reporterPath = path.join(tmp, 'reporter.mjs');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      reporterPath,
      "import { writeFileSync } from 'node:fs';\n" +
        `writeFileSync(process.argv[2], process.env.${DAEMON_CHILD_ENV_VAR} ?? 'unset');\n`,
      'utf8',
    );
    try {
      const pid = await spawnDetachedDaemon({ scriptPath: reporterPath, args: [readyMarker] });
      await waitForFile(readyMarker, 5_000);
      expect(await readFile(readyMarker, 'utf8')).toBe('1');
      // Best-effort cleanup — this one exits on its own almost immediately, unlike the fixture
      // above, so a failed kill here (process already gone) is not itself a problem.
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already exited.
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
