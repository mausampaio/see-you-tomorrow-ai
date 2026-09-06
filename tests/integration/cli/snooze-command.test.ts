/**
 * `runSnoozeCommand`/`runSkipTodayCommand` against a REAL `StorageAdapter` over a `tmpdir` — the
 * one thing `tests/unit/cli/snooze-command.test.ts` (an in-memory `Storage` double) cannot prove:
 * that `estado.json` really round-trips through disk, and that a `Storage` built as a completely
 * separate instance later — modeling a daemon poll that starts after the CLI command already
 * exited, no shared process or in-memory state at all — reads exactly what was written
 * (docs/ESPECIFICACAO.md § "seeya snooze...": "funciona com ou sem daemon rodando").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import { DEFAULT_CONFIG } from '../../../src/adapters/storage/config-schema.js';
import { runSkipTodayCommand, runSnoozeCommand } from '../../../src/cli/snooze-command.js';
import { FakeClock } from '../discovery/_fake-clock.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  type DiscoveryFixture,
} from '../discovery/_fixtures.js';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

const NOMINAL_9AM = new Date(2026, 7, 16, 9, 0, 0);

describe('runSnoozeCommand / runSkipTodayCommand against a real StorageAdapter', () => {
  it('a snooze written by one Storage instance is read back by a brand-new, unrelated instance — proves "works without the daemon running"', async () => {
    fixture = await createDiscoveryFixture();
    const writerStorage = new StorageAdapter(fixture.seeyaHome);
    const config = { ...DEFAULT_CONFIG, endOfDayTime: '19:30' };

    await runSnoozeCommand(
      { storage: writerStorage, clock: new FakeClock(NOMINAL_9AM), config },
      '+30m',
    );

    // A fresh `StorageAdapter`, pointed at the same seeyaHome, standing in for a daemon process
    // that was never running while the command above executed and only starts polling later.
    const readerStorage = new StorageAdapter(fixture.seeyaHome);
    const state = await readerStorage.readState();
    expect(state).not.toBeNull();
    expect(state?.snoozeMinutesTotal).toBe(30);
    expect(state?.day).toBe('2026-08-16');
  });

  it('estado.json really lands on disk with the expected shape (not just readable through the same class)', async () => {
    fixture = await createDiscoveryFixture();
    const storage = new StorageAdapter(fixture.seeyaHome);
    await runSkipTodayCommand({
      storage,
      clock: new FakeClock(NOMINAL_9AM),
      config: { ...DEFAULT_CONFIG, endOfDayTime: '19:30' },
    });

    const raw: unknown = JSON.parse(
      await readFile(path.join(fixture.seeyaHome, 'estado.json'), 'utf8'),
    );
    expect(raw).toMatchObject({ schemaVersion: 1, skipped: true, day: '2026-08-16' });
  });

  it('two snoozes across two separate command invocations (two separate Storage instances) accumulate on disk', async () => {
    fixture = await createDiscoveryFixture();
    const config = { ...DEFAULT_CONFIG, endOfDayTime: '19:30' };

    await runSnoozeCommand(
      { storage: new StorageAdapter(fixture.seeyaHome), clock: new FakeClock(NOMINAL_9AM), config },
      '+15m',
    );
    await runSnoozeCommand(
      { storage: new StorageAdapter(fixture.seeyaHome), clock: new FakeClock(NOMINAL_9AM), config },
      '+30m',
    );

    const state = await new StorageAdapter(fixture.seeyaHome).readState();
    expect(state?.snoozeMinutesTotal).toBe(45);
  });

  it('a midnight rollover resets skip/snooze on disk but daemonHealth survives (S4-T3b), exactly like the in-memory suite proves', async () => {
    fixture = await createDiscoveryFixture();
    const config = { ...DEFAULT_CONFIG, endOfDayTime: '19:30' };
    // Hand-write yesterday's document directly, the way a real daemon left it — including a
    // daemonHealth failure streak, which is the one field that must NOT reset.
    await writeFile(
      path.join(fixture.seeyaHome, 'estado.json'),
      JSON.stringify({
        schemaVersion: 1,
        day: '2026-08-16',
        skipped: true,
        snoozeMinutesTotal: 500,
        firedLeadTimesInMinutes: [30, 15],
        endOfDayFired: true,
        captureAttemptsToday: { s1: 3 },
        daemonHealth: {
          lastCycleError: { message: 'boom', at: '2026-08-16T10:00:00.000Z' },
          consecutiveCycleFailures: 7,
        },
      }),
      'utf8',
    );

    const nextDay = new Date(2026, 7, 17, 9, 0, 0);
    await runSnoozeCommand(
      { storage: new StorageAdapter(fixture.seeyaHome), clock: new FakeClock(nextDay), config },
      '+15m',
    );

    const state = await new StorageAdapter(fixture.seeyaHome).readState();
    expect(state?.day).toBe('2026-08-17');
    expect(state?.skipped).toBe(false);
    expect(state?.snoozeMinutesTotal).toBe(15);
    expect(state?.daemonHealth.consecutiveCycleFailures).toBe(7);
  });
});
