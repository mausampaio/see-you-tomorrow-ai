/**
 * E2E nº8 (docs/TESTES.md § E2E): "Segunda instância do daemon recusa subir por causa do lock."
 * Runs the COMPILED `dist/cli/index.js` (via `_harness.ts#runSeeya`), spawning a REAL detached
 * daemon worker — this is the one journey in this suite that outlives the `seeya` process that
 * started it, exactly like a real user's machine.
 *
 * **Extended by S4-T5 to also cover `--stop`/`--status`** — the sprint's own aceite groups all
 * three of items 6/7/8 together, but items 6 and 7 remain blocked for reasons unrelated to this
 * task (see this file's own closing comment and docs/TESTES.md's own note, unchanged by S4-T5):
 * item 6 needs a clock-injection point in the compiled binary that still doesn't exist, and the
 * daemon's own default (no `~/.seeya/config.json` written here) keeps `endOfDayTime` at its
 * `null` default, so no capture, no lead-time warning and no `claude` call is ever attempted —
 * the poll this test's daemon runs is always the cheap `'disabled'` branch of `decideSchedule`.
 *
 * No `config.json` is written on purpose: default `endOfDayTime: null` means every poll takes the
 * `'disabled'` branch (`core/schedule.ts`) — no capture, no `claude` call, nothing that could make
 * this journey slow or flaky for reasons unrelated to the lock/stop/status mechanism under test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createE2eHome, removeE2eHome, runSeeya, type E2eHome } from './_harness.js';
import { processExists } from '../../src/adapters/process/existence.js';

let home: E2eHome | undefined;
let lastDaemonPid: number | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort: whatever daemon this test last started, dead or not by the time the test itself
 * finishes — a failing assertion mid-test must never leave a REAL detached process behind for the
 * next test file to trip over. */
afterEach(async () => {
  if (lastDaemonPid !== undefined) {
    try {
      process.kill(lastDaemonPid, 'SIGKILL');
    } catch {
      // Already gone — the common case when the test's own `--stop` step already worked.
    }
    lastDaemonPid = undefined;
  }
  if (home !== undefined) {
    await removeE2eHome(home);
    home = undefined;
  }
});

function extractPid(stdout: string): number {
  const match = /pid (\d+)/.exec(stdout);
  if (match === null) {
    throw new Error(`expected a "pid <N>" in stdout, got: ${JSON.stringify(stdout)}`);
  }
  return Number(match[1]);
}

/** Polls `processExists` instead of a fixed sleep — the daemon's own exit, after either a real
 * graceful SIGTERM or a forced kill, is fast (S4-T5's chunked wait, `scheduler/loop.ts#
 * sleepUntilNextPollOrStop`) but not INSTANT, and a fixed sleep would either waste time on the
 * common fast path or flake on a loaded CI runner. */
async function waitUntilGone(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await processExists(pid)) {
    if (Date.now() > deadline) {
      throw new Error(`pid ${pid} was still alive ${timeoutMs}ms after being asked to stop`);
    }
    await sleep(100);
  }
}

/**
 * The launcher (`runSeeya(['daemon'])`) returns the instant it has SPAWNED the detached worker
 * (`.unref()`, D-005) — it never waits for the worker to finish acquiring the lock itself
 * (`scheduler/loop.ts#runDaemon`'s own first `await`). Calling `seeya daemon` a second time
 * immediately after the first `runSeeya` resolves is a genuine race in THIS TEST, not in the
 * product: the real instance-uniqueness check (`core/daemon-lock.ts#decideLockAcquisition`) is
 * already proven elsewhere (`tests/integration/cli/daemon-command.test.ts`,
 * `tests/unit/scheduler/loop.test.ts`) against a lock that is already known to exist. This just
 * waits for `daemon.lock` to actually land on disk before treating "the first daemon is up" as
 * true, the same way `tests/integration/process/daemon-launch.test.ts` waits for a ready marker
 * instead of assuming a spawned process is instantly fully started.
 */
async function waitForLockFile(home: E2eHome, timeoutMs: number): Promise<void> {
  const lockPath = path.join(home.seeyaHome, 'daemon.lock');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await readFile(lockPath, 'utf8');
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`${lockPath} never appeared within ${timeoutMs}ms`);
      }
      await sleep(50);
    }
  }
}

describe('e2e: seeya daemon — instância única, --status e --stop', () => {
  it(
    'a second daemon refuses while the first is alive; --status/--stop see and act on the ' +
      'SAME real lock; the lock never lingers, so a third daemon starts clean',
    async () => {
      home = await createE2eHome();

      // 1. First daemon: starts for real, detached, and prints its own pid.
      const first = await runSeeya(home, ['daemon']);
      expect(first.exitCode, `stderr: ${first.stderr}`).toBe(0);
      expect(first.stdout).toContain('seeya daemon started');
      const firstPid = extractPid(first.stdout);
      lastDaemonPid = firstPid;
      expect(await processExists(firstPid)).toBe(true);
      await waitForLockFile(home, 5_000);

      // 2. Second instance refuses — the lock the first one wrote is honored (D-005).
      const second = await runSeeya(home, ['daemon']);
      expect(second.exitCode, `stderr: ${second.stderr}`).toBe(0);
      expect(second.stdout).toContain('already running');
      expect(second.stdout).toContain(String(firstPid));
      // Refusing never spawned a second worker — still exactly one process for this pid.
      expect(await processExists(firstPid)).toBe(true);

      // 3. --status sees the SAME real lock, confirmed alive (S4-T3b's own tie-break, exercised
      // here against a real, freshly-captured procStart — not a fake).
      const statusWhileAlive = await runSeeya(home, ['daemon', '--status']);
      expect(statusWhileAlive.exitCode, `stderr: ${statusWhileAlive.stderr}`).toBe(0);
      expect(statusWhileAlive.stdout).toContain(`Daemon: running (pid ${firstPid}`);
      expect(statusWhileAlive.stdout).toContain('Daemon health: healthy');

      // 4. --stop asks the real daemon to end, on whichever platform this actually runs on — no
      // `platform` override here on purpose, unlike the integration-level tests, which force each
      // branch portably. This is the one test in the whole suite that proves the REAL, unforced
      // platform dispatch end to end.
      const stop = await runSeeya(home, ['daemon', '--stop']);
      expect(stop.exitCode, `stderr: ${stop.stderr}`).toBe(0);
      expect(stop.stdout).toContain(`Stopped the daemon (pid ${firstPid})`);
      await waitUntilGone(firstPid, 10_000);
      lastDaemonPid = undefined;

      // 5. --status now reports "not running" — same lock file, re-evaluated, never a leftover
      // "running" just because the file still happens to exist on disk (D-024/D-025).
      const statusAfterStop = await runSeeya(home, ['daemon', '--status']);
      expect(statusAfterStop.exitCode, `stderr: ${statusAfterStop.stderr}`).toBe(0);
      expect(statusAfterStop.stdout).toContain('Daemon: not running');

      // 6. The acceptance that matters most: the lock did not linger. A third daemon starts
      // clean, with its OWN new pid — proof `--stop` actually cleared `daemon.lock`, not just
      // that the OS process happened to be gone.
      const third = await runSeeya(home, ['daemon']);
      expect(third.exitCode, `stderr: ${third.stderr}`).toBe(0);
      expect(third.stdout).toContain('seeya daemon started');
      const thirdPid = extractPid(third.stdout);
      expect(thirdPid).not.toBe(firstPid);
      lastDaemonPid = thirdPid;
      expect(await processExists(thirdPid)).toBe(true);
    },
    30_000, // real detached processes + a real (if now fast, S4-T5) stop — generous, not tight
  );
});

// **Items 6 and 7 of docs/TESTES.md § E2E remain without a test, unchanged by this task.**
// Item 6 (lead-time warning then close, with an injected clock) needs a clock-injection point in
// `dist/cli/index.js` that doesn't exist — `cli/index.ts` always builds the real `systemClock`,
// and the daemon's own loop only ever fires on real 30s-grained windows, which would make this
// journey "poucos e caros" into "caro demais" (minutes of real wall-clock waiting per run). Item 7
// (`seeya snooze`/`seeya skip-today` against a running daemon) was deliberately left ungrouped
// from item 8 by the S4-T4 task, for the same reason repeated in docs/PLANO-DE-ENTREGA.md: landing
// 6/7/8 together as one "full day" journey once 6 stops being blocked, rather than as three
// separate pieces. That blocker is unchanged here — S4-T5 delivers exactly what's newly possible
// (item 8, now proven end to end together with `--stop`/`--status`) and does not force items 6/7
// into a test that would only APPEAR to cover them.
