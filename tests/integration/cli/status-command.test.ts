/**
 * `runStatusCommand` against a real fake `~/.claude` in `tmpdir` — same boundary as
 * `sessions-command.test.ts`: the real `DiscoverySessionProvider` and a real `StorageAdapter`,
 * with only `ProcessControl` faked. Covers the discovery half of `seeya status`
 * (docs/ESPECIFICACAO.md § "seeya status"): configured end-of-day time and the
 * eligible/discovered session counts. The schedule/daemon half (S4-T13) — snooze, skip-today,
 * already-ran, and the four daemon states — is exercised against pure fakes instead, in
 * `tests/unit/cli/status-command.test.ts` and `tests/unit/cli/daemon-status-agreement.test.ts`;
 * no test here writes a `daemon.lock`, so `checkLiveLock` never calls `ProcessControl.isAlive` in
 * this file (`daemonPorts()`'s own docstring below).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DiscoverySessionProvider } from '../../../src/adapters/discovery/index.js';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import { runStatusCommand } from '../../../src/cli/status-command.js';
import type { Config } from '../../../src/core/types.js';
import { FakeClock } from '../discovery/_fake-clock.js';
import { FakeProcessControl } from '../discovery/_fake-process-control.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  writeSessionRecord,
  type DiscoveryFixture,
} from '../discovery/_fixtures.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const RELEVANCE_HOURS = 12;

function config(overrides: Partial<Config> = {}): Config {
  return {
    endOfDayTime: null,
    leadTimesInMinutes: [30, 15],
    relevanceHours: RELEVANCE_HOURS,
    idleMinutes: 45,
    captureModel: 'sonnet',
    budgetPerSessionUsd: 0.25,
    captureConcurrency: 3,
    ignore: [],
    projectPolicy: {},
    forkCleanupDays: 7,
    maxGitRootsToVisit: 8,
    maxCaptureAttemptsPerSessionPerDay: 3,
    maxBriefingScanDays: 30,
    overdueFireThresholdMinutes: 5,
    leadTimeHysteresisMinutes: 3,
    ...overrides,
  };
}

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

function provider(): DiscoverySessionProvider {
  if (fixture === undefined) {
    throw new Error('call createDiscoveryFixture() first');
  }
  return new DiscoverySessionProvider({
    claudeHome: fixture.claudeHome,
    seeyaHome: fixture.seeyaHome,
    processControl: new FakeProcessControl(),
    clock: new FakeClock(NOW),
    relevanceHours: RELEVANCE_HOURS,
  });
}

/**
 * S4-T13: `runStatusCommand` also needs `Storage`/`ProcessControl` for the daemon section
 * (`cli/daemon-state.ts#describeDaemonState`). No test in this file ever writes `daemon.lock`, so
 * a real `StorageAdapter` over the fixture's own `seeyaHome` always reads it back as `null`
 * (D-025) — `checkLiveLock` never calls `ProcessControl.isAlive` at all in that path, so the
 * `FakeProcessControl` here is never actually exercised, only structurally required.
 */
function daemonPorts(): { storage: StorageAdapter; processControl: FakeProcessControl } {
  if (fixture === undefined) {
    throw new Error('call createDiscoveryFixture() first');
  }
  return {
    storage: new StorageAdapter(fixture.seeyaHome),
    processControl: new FakeProcessControl(),
  };
}

describe('runStatusCommand', () => {
  it('shows the configured end-of-day time and counts a recently-active session as eligible', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\projeto',
      startedAt: NOW.getTime() - 60_000,
      procStart: '1',
      name: 'projeto',
    });

    const report = await runStatusCommand({
      sessionProvider: provider(),
      config: config({ endOfDayTime: '19:30' }),
      clock: new FakeClock(NOW),
      ...daemonPorts(),
    });

    expect(report).toContain('End-of-day time: 19:30 local');
    expect(report).toContain('Eligible sessions: 1 of 1 discovered');
  });

  it('a discovered session in config.ignore is counted as discovered but not eligible', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\ignorado',
      startedAt: NOW.getTime() - 60_000,
      procStart: '1',
      name: 'ignorado',
    });

    const report = await runStatusCommand({
      sessionProvider: provider(),
      config: config({ ignore: ['c:\\code\\ignorado'] }),
      clock: new FakeClock(NOW),
      ...daemonPorts(),
    });

    expect(report).toContain('Eligible sessions: 0 of 1 discovered');
  });

  it('with no config.json written yet, shows "not configured" (D-025: absence is not a claim)', async () => {
    fixture = await createDiscoveryFixture();

    const report = await runStatusCommand({
      sessionProvider: provider(),
      config: config({ endOfDayTime: null }),
      clock: new FakeClock(NOW),
      ...daemonPorts(),
    });

    expect(report).toContain('End-of-day time: not configured (manual only)');
    expect(report).toContain('Eligible sessions: 0 of 0 discovered');
  });
});
