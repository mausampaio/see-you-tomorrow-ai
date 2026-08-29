/**
 * `runStatusCommand` against a real fake `~/.claude` in `tmpdir` — same boundary as
 * `sessions-command.test.ts`: the real `DiscoverySessionProvider`, with only `ProcessControl`
 * faked. Covers docs/ESPECIFICACAO.md § "seeya status"'s reduced S1-T6 scope (docs/QUESTOES.md
 * Q-015): configured end-of-day time and the eligible/discovered session counts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DiscoverySessionProvider } from '../../../src/adapters/discovery/index.js';
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
    });

    expect(report).toContain('Eligible sessions: 0 of 1 discovered');
  });

  it('with no config.json written yet, shows "not configured" (D-025: absence is not a claim)', async () => {
    fixture = await createDiscoveryFixture();

    const report = await runStatusCommand({
      sessionProvider: provider(),
      config: config({ endOfDayTime: null }),
      clock: new FakeClock(NOW),
    });

    expect(report).toContain('End-of-day time: not configured (manual only)');
    expect(report).toContain('Eligible sessions: 0 of 0 discovered');
  });
});
