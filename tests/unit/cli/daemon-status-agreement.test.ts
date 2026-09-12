/**
 * S4-T13's own acceptance criterion, verified directly: `seeya daemon --status`
 * (`cli/daemon-command.ts#runDaemonStatus`) and `seeya status`
 * (`cli/status-command.ts#runStatusCommand`) must never disagree about the daemon, because both
 * render it through the exact same `cli/daemon-state.ts#describeDaemonState` call over the same
 * `Storage`. Exercised across all four D-024 liveness states — `noLock`/`dead`/`alive`/`unknown`
 * — plus a failing health streak, so this isn't just true by construction for the trivial "no
 * lock" case.
 */
import { describe, expect, it } from 'vitest';
import { runDaemonStatus } from '../../../src/cli/daemon-command.js';
import { runStatusCommand } from '../../../src/cli/status-command.js';
import type { ProcessControl } from '../../../src/core/ports.js';
import { NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES } from '../../../src/core/daemon-health.js';
import { emptyDayState } from '../../../src/core/schedule.js';
import { createConfig } from '../core/_fixtures.js';
import { InMemoryDaemonStorage } from '../scheduler/_fakes.js';
import { FakeClock, FakeSessionProvider } from '../application/_fakes.js';

const NOW = new Date('2026-09-05T10:00:00.000Z');
const LOCK = { pid: 4242, startedAt: NOW, procStart: '123-456' };

class ScriptedProcessControl implements ProcessControl {
  constructor(private readonly aliveResult: () => boolean) {}
  isAlive(): Promise<boolean> {
    return Promise.resolve(this.aliveResult());
  }
  terminateGracefully(): Promise<boolean> {
    return Promise.reject(new Error('not exercised by this agreement check'));
  }
}

class ThrowingProcessControl implements ProcessControl {
  isAlive(): Promise<boolean> {
    return Promise.reject(new Error('unrecognized errno'));
  }
  terminateGracefully(): Promise<boolean> {
    return Promise.reject(new Error('not exercised by this agreement check'));
  }
}

async function bothReports(
  storage: InMemoryDaemonStorage,
  processControl: ProcessControl,
): Promise<{ readonly daemonStatus: string; readonly status: string }> {
  const clock = new FakeClock(NOW);
  const daemonStatus = await runDaemonStatus({ storage, processControl, clock });
  const status = await runStatusCommand({
    sessionProvider: new FakeSessionProvider({ sessions: [], rejected: [] }),
    config: await storage.readConfig(),
    clock,
    storage,
    processControl,
  });
  return { daemonStatus, status };
}

describe('seeya daemon --status vs seeya status — the daemon section never disagrees', () => {
  it('no lock at all', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    const { daemonStatus, status } = await bothReports(
      storage,
      new ScriptedProcessControl(() => true),
    );

    expect(status).toContain(daemonStatus);
  });

  it('a stale lock (pid confirmed dead)', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    await storage.writeDaemonLock(LOCK);
    const { daemonStatus, status } = await bothReports(
      storage,
      new ScriptedProcessControl(() => false),
    );

    expect(status).toContain(daemonStatus);
    expect(daemonStatus).toContain('Daemon: not running (a stale lock file for pid 4242');
  });

  it('a confirmed-alive daemon, healthy', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    await storage.writeDaemonLock(LOCK);
    const { daemonStatus, status } = await bothReports(
      storage,
      new ScriptedProcessControl(() => true),
    );

    expect(status).toContain(daemonStatus);
    expect(daemonStatus).toContain('Daemon: running (pid 4242');
  });

  it('a confirmed-alive daemon with a failure streak', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    await storage.writeDaemonLock(LOCK);
    await storage.saveState({
      ...emptyDayState('2026-09-05'),
      daemonHealth: {
        lastCycleError: { message: 'ECONNREFUSED', at: NOW },
        consecutiveCycleFailures: NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES,
      },
    });
    const { daemonStatus, status } = await bothReports(
      storage,
      new ScriptedProcessControl(() => true),
    );

    expect(status).toContain(daemonStatus);
    expect(daemonStatus).toContain('ECONNREFUSED');
  });

  it('a liveness check that throws — neither "running" nor "not running"', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    await storage.writeDaemonLock(LOCK);
    const { daemonStatus, status } = await bothReports(storage, new ThrowingProcessControl());

    expect(status).toContain(daemonStatus);
    expect(daemonStatus).toContain('could not verify whether it is still alive');
  });

  it('a snoozed, still-waiting schedule', async () => {
    const storage = new InMemoryDaemonStorage(createConfig());
    await storage.saveState({ ...emptyDayState('2026-09-05'), snoozeMinutesTotal: 45 });
    const { daemonStatus, status } = await bothReports(
      storage,
      new ScriptedProcessControl(() => false),
    );

    expect(status).toContain(daemonStatus);
    expect(daemonStatus).toContain('Snoozed today: 45 minute(s) total.');
  });
});
