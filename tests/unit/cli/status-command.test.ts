/**
 * `cli/status-command.ts` (S4-T13): the schedule/daemon half of `seeya status`, exercised here
 * entirely against fakes (no discovery fixture — `tests/integration/cli/status-command.test.ts`
 * already covers the discovered/eligible session counts against a real `DiscoverySessionProvider`
 * in a `tmpdir`). This file's own job is the five schedule shapes docs/PLANO-DE-ENTREGA.md S4-T13
 * names by name: manual-only, not-yet-started-today, snoozed, skipped, already-ran — plus proving
 * the daemon section really comes from `cli/daemon-state.ts#describeDaemonState` unchanged.
 */
import { describe, expect, it } from 'vitest';
import { runStatusCommand } from '../../../src/cli/status-command.js';
import type { ProcessControl } from '../../../src/core/ports.js';
import { emptyDayState } from '../../../src/core/schedule.js';
import { createConfig } from '../core/_fixtures.js';
import { InMemoryDaemonStorage } from '../scheduler/_fakes.js';
import { FakeClock, FakeSessionProvider } from '../application/_fakes.js';

const NOW = new Date('2026-09-05T10:00:00.000Z');

/**
 * The LOCAL wall-clock time `minutesFromNow` away from `NOW`, `"HH:MM"` — used instead of a
 * hardcoded string wherever a test needs a config time close to "now": `core/schedule.ts` works
 * entirely in local wall-clock time (D-019/`docs/ARQUITETURA.md` § "Fusos e horários"), and `NOW`
 * itself is a fixed UTC instant, so its LOCAL hour depends on whichever timezone actually runs
 * this suite. Computing the expected string the same way `core/schedule.ts`'s own `localTime`
 * helper does keeps the assertion true in any timezone, not just this machine's.
 */
function localTimeOffsetFromNow(minutesFromNow: number): string {
  const pad2 = (value: number): string => String(value).padStart(2, '0');
  const target = new Date(NOW.getTime() + minutesFromNow * 60_000);
  return `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
}

/** Always reports `alive` as scripted, never actually reachable from this file's own tests
 * without a lock written first — mirrors `tests/unit/cli/daemon-command.test.ts#FixedAliveness`. */
class FixedAliveness implements ProcessControl {
  constructor(private readonly alive: boolean) {}
  isAlive(): Promise<boolean> {
    return Promise.resolve(this.alive);
  }
  terminateGracefully(): Promise<boolean> {
    return Promise.reject(new Error('not exercised — seeya status never stops anything'));
  }
}

/**
 * `config` comes from the SAME `storage` the test seeded — `describeDaemonState` itself always
 * re-reads `storage.readConfig()` (never a value cached before this call), so a fake that read
 * `endOfDayTime` from one `Config` while `StatusCommandContext.config` held a different one would
 * test a shape production can't actually produce.
 */
async function buildContext(storage: InMemoryDaemonStorage, processControl: ProcessControl) {
  return {
    sessionProvider: new FakeSessionProvider({ sessions: [], rejected: [] }),
    config: await storage.readConfig(),
    clock: new FakeClock(NOW),
    storage,
    processControl,
  };
}

describe('runStatusCommand — schedule shapes (S4-T13)', () => {
  it('manual-only: endOfDayTime unset shows no invented effective time (D-025)', async () => {
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: null }));
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(false)));

    expect(report).toContain('End-of-day time: not configured (manual only)');
    expect(report).toContain('End-of-day: not configured (manual only).');
  });

  it('no estado.json yet today reads as "not reached yet", never as an error (D-025)', async () => {
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: '19:30' }));
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(false)));

    expect(report).toContain('End-of-day: scheduled for 19:30, not reached yet.');
  });

  it('skipped today (seeya skip-today) is reflected without mentioning a time', async () => {
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: '19:30' }));
    await storage.saveState({ ...emptyDayState('2026-09-05'), skipped: true });
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(false)));

    expect(report).toContain(
      'End-of-day: skipped today (seeya skip-today) — will resume tomorrow.',
    );
  });

  it('accumulated snooze shows the total minutes, on top of the shifted effective time', async () => {
    // Nominal time is 15 minutes ahead of NOW; the 30-minute snooze below shifts the EFFECTIVE
    // time to 45 minutes ahead — safely past every default lead time (30/15 min), so this stays
    // "waiting" regardless of which timezone actually runs this suite (measured: a literal
    // "09:45"/"10:15" pair, tried first, passed on this machine at UTC-3 but FAILED under
    // `npm run verificar:linux`'s UTC container, where NOW's local hour lands close enough to
    // 10:15 that the 30-minute lead-time rule was already due instead of still "waiting").
    const nominal = localTimeOffsetFromNow(15);
    const effective = localTimeOffsetFromNow(45);
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: nominal }));
    await storage.saveState({ ...emptyDayState('2026-09-05'), snoozeMinutesTotal: 30 });
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(false)));

    expect(report).toContain(`End-of-day: scheduled for ${effective}, not reached yet.`);
    expect(report).toContain('Snoozed today: 30 minute(s) total.');
  });

  it('inside a lead-time warning window: names the rule that fired and the effective time', async () => {
    const effectiveEndOfDay = localTimeOffsetFromNow(20);
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: effectiveEndOfDay }));
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(false)));

    // Default leadTimesInMinutes [30, 15]; NOW is 20 minutes before the effective time, so the
    // 30-minute rule is already due and the 15-minute one is not yet.
    expect(report).toContain(`End-of-day: closing in about 30 minute(s), at ${effectiveEndOfDay}.`);
  });

  it('past the effective deadline: due now, with the delay named (a late/suspended-machine trigger)', async () => {
    const effectiveEndOfDay = localTimeOffsetFromNow(-30);
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: effectiveEndOfDay }));
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(false)));

    expect(report).toContain(
      `End-of-day: due now (${effectiveEndOfDay}, about 30 minute(s) past) — the next poll acts on this.`,
    );
  });

  it('already ran today: sticky, never re-opened by anything status itself does', async () => {
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: '09:00' }));
    await storage.saveState({ ...emptyDayState('2026-09-05'), endOfDayFired: true });
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(false)));

    expect(report).toContain('End-of-day: already ran today (effective 09:00).');
  });

  it('the daemon section is exactly what cli/daemon-state.ts#describeDaemonState renders, embedded whole', async () => {
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: '19:30' }));
    await storage.writeDaemonLock({
      pid: 4242,
      startedAt: NOW,
      procStart: '123-456',
    });
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(true)));

    expect(report).toContain('Daemon: running (pid 4242, started 2026-09-05T10:00:00.000Z).');
    expect(report).toContain('Daemon health: healthy — no failed cycles recorded.');
  });

  it('still shows the discovered/eligible session lines above the daemon section (S1-T6 scope kept)', async () => {
    const storage = new InMemoryDaemonStorage(createConfig({ endOfDayTime: null }));
    const report = await runStatusCommand(await buildContext(storage, new FixedAliveness(false)));

    expect(report).toContain('Eligible sessions: 0 of 0 discovered');
  });
});
