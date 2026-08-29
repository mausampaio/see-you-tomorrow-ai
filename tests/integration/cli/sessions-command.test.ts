/**
 * `runSessionsCommand` against a real fake `~/.claude` in `tmpdir` (docs/TESTES.md § E2E nº1's
 * own acceptance: "vivas, ociosas e encerradas" — and the two rules the task text calls out by
 * name: D-021 (a missing cosmetic field never hides a session) and D-022/Q-012 (rejections have
 * to reach whoever reads `seeya sessions`). The real `DiscoverySessionProvider` runs here, with
 * only `ProcessControl`/`Clock` faked — same boundary `session-provider.test.ts` already draws.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DiscoverySessionProvider } from '../../../src/adapters/discovery/index.js';
import { runSessionsCommand } from '../../../src/cli/sessions-command.js';
import type { Config } from '../../../src/core/types.js';
import { FakeClock } from '../discovery/_fake-clock.js';
import { FakeProcessControl } from '../discovery/_fake-process-control.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  transcriptLine,
  writeSessionRecord,
  writeTranscriptWithContent,
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

function provider(aliveByPid?: ReadonlyMap<number, boolean>): DiscoverySessionProvider {
  if (fixture === undefined) {
    throw new Error('call createDiscoveryFixture() first');
  }
  return new DiscoverySessionProvider({
    claudeHome: fixture.claudeHome,
    seeyaHome: fixture.seeyaHome,
    processControl: new FakeProcessControl(aliveByPid),
    clock: new FakeClock(NOW),
    relevanceHours: RELEVANCE_HOURS,
  });
}

describe('runSessionsCommand', () => {
  it('D-021: a registry entry with no "name" field is still reported, named from its cwd', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\sem-nome',
      startedAt: NOW.getTime() - 60_000,
      procStart: '1',
      // no "name": the point of this test.
    });

    const report = await runSessionsCommand({
      sessionProvider: provider(),
      config: config(),
      clock: new FakeClock(NOW),
    });

    expect(report).toContain('1 session found.');
    expect(report).toContain('sem-nome');
  });

  it('D-022/Q-012: an ignored entry is reported alongside the accepted session, never dropped', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\projeto',
      startedAt: NOW.getTime() - 60_000,
      procStart: '1',
      name: 'projeto',
    });
    await writeFile(path.join(fixture.sessionsDir, 'broken.json'), 'not json {{{', 'utf8');

    const report = await runSessionsCommand({
      sessionProvider: provider(),
      config: config(),
      clock: new FakeClock(NOW),
    });

    expect(report).toContain('1 session found, 1 entry ignored.');
    expect(report).toContain('Ignored entries:');
    expect(report).toContain('broken.json');
  });

  it('a live process with no transcript write reports "alive", not "idle" (D-025)', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\vivo',
      startedAt: NOW.getTime() - 60_000,
      procStart: '1',
      name: 'vivo',
    });

    const report = await runSessionsCommand({
      sessionProvider: provider(new Map([[4242, true]])),
      config: config(),
      clock: new FakeClock(NOW),
    });

    expect(report).toContain('state: alive');
  });

  it('a live process idle past idleMinutes (real transcript mtime) reports "idle"', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\ocioso',
      startedAt: NOW.getTime() - 2 * 60 * 60_000,
      procStart: '1',
      name: 'ocioso',
    });
    await writeTranscriptWithContent(
      fixture,
      'c--code-ocioso',
      '11111111-1111-4111-8111-111111111111',
      transcriptLine('c:\\code\\ocioso'),
      new Date(NOW.getTime() - 60 * 60_000), // one hour of silence, past the 45m default
    );

    const report = await runSessionsCommand({
      sessionProvider: provider(new Map([[4242, true]])),
      config: config(),
      clock: new FakeClock(NOW),
    });

    expect(report).toContain('state: idle');
  });

  it('a stale registry entry (dead pid) is reported "ended", not discarded (docs/ESPECIFICACAO.md)', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\encerrado',
      startedAt: NOW.getTime() - 60_000,
      procStart: '1',
      name: 'encerrado',
    });

    const report = await runSessionsCommand({
      sessionProvider: provider(new Map([[4242, false]])),
      config: config(),
      clock: new FakeClock(NOW),
    });

    expect(report).toContain('state: ended');
  });

  it('a headless (no-pid) transcript-only session is reported "unknown", never "ended" (D-016/D-025)', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'c--code-headless',
      '33333333-3333-4333-8333-333333333333',
      transcriptLine('c:\\code\\headless'),
      new Date(NOW.getTime() - 5 * 60_000),
    );

    const report = await runSessionsCommand({
      sessionProvider: provider(),
      config: config(),
      clock: new FakeClock(NOW),
    });

    expect(report).toContain('1 session found.');
    expect(report).toContain('state: unknown');
  });
});
