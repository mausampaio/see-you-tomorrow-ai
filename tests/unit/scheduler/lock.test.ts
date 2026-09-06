/**
 * `scheduler/lock.ts` (S4-T3): wires `core/daemon-lock.ts`'s pure decision to `Storage`/
 * `ProcessControl`.
 */
import { describe, expect, it } from 'vitest';
import { acquireDaemonLock, checkDaemonLock } from '../../../src/scheduler/lock.js';
import { InMemoryDaemonStorage, ControllableProcessControl } from './_fakes.js';
import { DEFAULT_TEST_CONFIG } from '../application/_fakes.js';

describe('checkDaemonLock', () => {
  it('acquires on a fresh machine (no lock ever written)', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    const processControl = new ControllableProcessControl();
    const decision = await checkDaemonLock(storage, processControl);
    expect(decision).toStrictEqual({ kind: 'acquire' });
  });

  it('refuses when the recorded pid is alive', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    await storage.writeDaemonLock({
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: undefined,
    });
    const processControl = new ControllableProcessControl(new Map([[4242, true]]));
    const decision = await checkDaemonLock(storage, processControl);
    expect(decision).toStrictEqual({ kind: 'refuse', heldByPid: 4242 });
  });

  it('acquires when the recorded pid is dead (stale lock)', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    await storage.writeDaemonLock({
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: undefined,
    });
    const processControl = new ControllableProcessControl(new Map([[4242, false]]));
    const decision = await checkDaemonLock(storage, processControl);
    expect(decision).toStrictEqual({ kind: 'acquire' });
  });

  it('never writes anything itself — a second read sees the exact same (or absent) lock', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    const processControl = new ControllableProcessControl();
    await checkDaemonLock(storage, processControl);
    expect(await storage.readDaemonLock()).toBeNull();
  });

  it('S4-T3b: passes the recorded procStart through to isAlive, never dropping it silently', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    await storage.writeDaemonLock({
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: 'the-recorded-value',
    });
    const processControl = new ControllableProcessControl(new Map([[4242, true]]));

    await checkDaemonLock(storage, processControl);

    expect(processControl.isAliveCalls).toStrictEqual([
      { pid: 4242, procStart: 'the-recorded-value' },
    ]);
  });

  it('S4-T3b: an older lock with no recorded procStart calls isAlive with undefined, not a fabricated value', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    await storage.writeDaemonLock({
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: undefined,
    });
    const processControl = new ControllableProcessControl(new Map([[4242, true]]));

    await checkDaemonLock(storage, processControl);

    expect(processControl.isAliveCalls).toStrictEqual([{ pid: 4242, procStart: undefined }]);
  });
});

describe('acquireDaemonLock', () => {
  it('writes the lock with the given pid/procStart/now on acquire', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    const processControl = new ControllableProcessControl();
    const now = new Date('2026-09-05T10:00:00.000Z');
    const decision = await acquireDaemonLock(storage, processControl, 555, 'my-proc-start', now);
    expect(decision).toStrictEqual({ kind: 'acquire' });
    expect(await storage.readDaemonLock()).toStrictEqual({
      pid: 555,
      startedAt: now,
      procStart: 'my-proc-start',
    });
  });

  it('writes procStart: undefined when the caller could not capture one', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    const processControl = new ControllableProcessControl();
    const now = new Date('2026-09-05T10:00:00.000Z');
    await acquireDaemonLock(storage, processControl, 555, undefined, now);
    expect(await storage.readDaemonLock()).toStrictEqual({
      pid: 555,
      startedAt: now,
      procStart: undefined,
    });
  });

  it('does not overwrite an existing, live lock on refuse', async () => {
    const storage = new InMemoryDaemonStorage(DEFAULT_TEST_CONFIG);
    const original = {
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: undefined,
    };
    await storage.writeDaemonLock(original);
    const processControl = new ControllableProcessControl(new Map([[4242, true]]));
    const decision = await acquireDaemonLock(
      storage,
      processControl,
      555,
      'ignored-because-refused',
      new Date('2026-09-05T10:00:00.000Z'),
    );
    expect(decision).toStrictEqual({ kind: 'refuse', heldByPid: 4242 });
    expect(await storage.readDaemonLock()).toStrictEqual(original);
  });
});
