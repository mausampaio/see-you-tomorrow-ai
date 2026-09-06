/**
 * `scheduler/lock.ts` wired to the REAL `adapters/process` (S4-T3b) — the recycled-PID tie-break
 * and the "no recorded procStart" fallback can't be proven with a fake `ProcessControl`, because a
 * fake doesn't implement the tie-break at all (see `tests/unit/scheduler/_fakes.ts`'s own
 * `ControllableProcessControl` docstring). This is exactly the "não acontece sozinho, precisa ser
 * construído" case docs/PLANO-DE-ENTREGA.md S4-T3b calls out.
 *
 * Reuses the same technique `tests/integration/process/liveness.test.ts` already established: a
 * real spawned child stands in for "the process the lock currently points at", and a deliberately
 * wrong `procStart` string stands in for a PID the OS recycled onto an unrelated process — the
 * PID really is alive (real OS state), but the CURRENT `procStart` genuinely disagrees with what
 * was recorded, exactly the shape a recycled PID produces. Forcing an ACTUAL OS-level PID reuse
 * portably in a test isn't possible; this reproduces the same observable evidence
 * `resolveIsAlive`'s comparison ever sees, which is what it's judged on either way.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDaemonLock, acquireDaemonLock } from '../../../src/scheduler/lock.js';
import { processControl } from '../../../src/adapters/process/index.js';
import { captureObservedProcStart } from '../../../src/adapters/process/proc-start.js';
import { processExists } from '../../../src/adapters/process/existence.js';
import { InMemoryDaemonStorage } from '../../unit/scheduler/_fakes.js';
import { DEFAULT_TEST_CONFIG } from '../../unit/application/_fakes.js';

const CHILD_SCRIPT = fileURLToPath(
  new URL('../../fixtures/process/graceful-child.mjs', import.meta.url),
);

let spawned: ChildProcess[] = [];

function spawnTrivialChild(): ChildProcess {
  const child = spawn(process.execPath, [CHILD_SCRIPT], { stdio: 'ignore' });
  spawned.push(child);
  return child;
}

/** Real capture via our own adapter — used to get the live child's ACTUAL procStart. */
async function readRealProcStart(pid: number): Promise<string> {
  const capture = await captureObservedProcStart(pid, processExists);
  if (capture.kind !== 'value') {
    throw new Error(`expected a real procStart capture, got ${JSON.stringify(capture)}`);
  }
  return capture.value;
}

afterEach(() => {
  for (const child of spawned) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead — fine, this is test cleanup, not the product's own termination policy.
    }
  }
  spawned = [];
});

describe('checkDaemonLock — recycled-PID tie-break, against real adapters/process', () => {
  it('a live pid whose recorded procStart no longer matches is treated as a DEAD lock (recycled PID) — the acceptance case this task exists for', async () => {
    const child = spawnTrivialChild();
    const pid = child.pid as number;
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    await storage.writeDaemonLock({
      pid,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: 'this-will-never-equal-a-real-capture',
    });

    // The PID is genuinely alive right now (a real child process) — proving the tie-break, not
    // basic PID liveness, is what's making the difference here.
    const decision = await checkDaemonLock(storage, processControl);

    expect(decision).toStrictEqual({ kind: 'acquire' });
  });

  it('a live pid whose recorded procStart DOES match refuses, naming the real holder', async () => {
    const child = spawnTrivialChild();
    const pid = child.pid as number;
    const realProcStart = await readRealProcStart(pid);
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    await storage.writeDaemonLock({
      pid,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: realProcStart,
    });

    const decision = await checkDaemonLock(storage, processControl);

    expect(decision).toStrictEqual({ kind: 'refuse', heldByPid: pid });
  });

  it('a live pid with NO recorded procStart (older lock format) still refuses — absence of the tie-break value is never treated as death (D-025)', async () => {
    const child = spawnTrivialChild();
    const pid = child.pid as number;
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    await storage.writeDaemonLock({
      pid,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: undefined,
    });

    const decision = await checkDaemonLock(storage, processControl);

    expect(decision).toStrictEqual({ kind: 'refuse', heldByPid: pid });
  });

  it('a genuinely dead pid acquires regardless of any recorded procStart (ordinary stale-lock case, unaffected by this task)', async () => {
    const child = spawnTrivialChild();
    const pid = child.pid as number;
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    await storage.writeDaemonLock({
      pid,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: 'whatever-was-recorded-does-not-matter-here',
    });

    const decision = await checkDaemonLock(storage, processControl);

    expect(decision).toStrictEqual({ kind: 'acquire' });
  });
});

describe('acquireDaemonLock — writes the caller-provided procStart, against real adapters/process', () => {
  it('writes a real, self-captured procStart on acquire, and it round-trips through Storage', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    // Stand-in for cli/index.ts's own self-capture (S4-T3b) — captured for the TEST RUNNER's own
    // pid, since that's the only pid this test can guarantee is alive.
    const ownProcStart = await readRealProcStart(process.pid);
    const now = new Date('2026-09-05T10:00:00.000Z');

    const decision = await acquireDaemonLock(
      storage,
      processControl,
      process.pid,
      ownProcStart,
      now,
    );

    expect(decision).toStrictEqual({ kind: 'acquire' });
    expect(await storage.readDaemonLock()).toStrictEqual({
      pid: process.pid,
      startedAt: now,
      procStart: ownProcStart,
    });
  });
});
