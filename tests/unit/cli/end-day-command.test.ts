/**
 * `runEndDayCommand` (S2-T5): `--session`'s id-or-cwd matching predicate and the "no match" short
 * circuit, plus the wiring into `application/endDay` + `formatEndDayReport`. Reuses
 * `tests/unit/application/_fakes.ts`'s named doubles (docs/TESTES.md: "duplo de I/O é
 * classe/objeto nomeado implementando a porta") instead of a second copy — `dependency-cruiser`
 * only governs `src/`, so a test-to-test import across faixas is not a layer violation.
 */
import { describe, expect, it } from 'vitest';
import { runEndDayCommand } from '../../../src/cli/end-day-command.js';
import { createSessionWithPid } from '../core/_fixtures.js';
import type { EndDayDeps } from '../../../src/application/types.js';
import type { Config } from '../../../src/core/types.js';
import {
  DEFAULT_TEST_CONFIG,
  FakeClock,
  FakeForkCleanup,
  FakeGitReader,
  FakeProcessControl,
  FakeSessionProvider,
  FakeStorage,
  FakeTranscriptReader,
  succeedingGenerator,
} from '../application/_fakes.js';

const NOW = new Date('2026-08-16T21:00:00.000Z');

function buildDeps(overrides: Partial<EndDayDeps> = {}): EndDayDeps {
  return {
    sessionProvider: new FakeSessionProvider({ sessions: [], rejected: [] }),
    transcriptReader: new FakeTranscriptReader(),
    gitReader: new FakeGitReader(),
    leanGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    deepGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    storage: new FakeStorage(DEFAULT_TEST_CONFIG),
    processControl: new FakeProcessControl(),
    clock: new FakeClock(NOW),
    forkCleanup: new FakeForkCleanup(),
    ...overrides,
  };
}

describe('runEndDayCommand — no --session', () => {
  it('captures every eligible session and formats the full report', async () => {
    const session = createSessionWithPid({ name: 'projeto-01', lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, { dryRun: false });
    expect(report).toContain('seeya end-day — 2026-08-16');
    expect(report).toContain('projeto-01');
  });
});

describe('runEndDayCommand — --session (S2-T5)', () => {
  function twoSessions() {
    const alpha = createSessionWithPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\alpha',
      name: 'alpha',
      lastActivity: NOW,
    });
    const beta = createSessionWithPid({
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: 'c:\\code\\beta',
      name: 'beta',
      lastActivity: NOW,
    });
    return { alpha, beta };
  }

  it('matches by sessionId and excludes the other discovered session', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: alpha.sessionId,
    });
    expect(report).toContain('alpha');
    expect(report).not.toContain('beta');
    expect(report).toContain('1 in scope');
  });

  it('matches by cwd just as well as by sessionId', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: beta.cwd,
    });
    expect(report).toContain('beta');
    expect(report).not.toContain('alpha');
  });

  it('a value matching nothing reports so explicitly, instead of a silent "0 in scope" report', async () => {
    const { alpha } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: 'nothing-matches-this',
    });
    expect(report).toBe(
      'No discovered session matches "nothing-matches-this" (checked against sessionId and cwd). ' +
        '1 session was discovered in total — see "seeya sessions" to list them.',
    );
  });

  // The count above is 1, so it only ever exercised the singular. Pairing it with a two-session
  // run is what actually covers the agreement — the message used to dodge the question with
  // "session(s)", and a test that never sees a plural would let that come back unnoticed.
  it('agrees with a plural count when more than one session was discovered', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: 'nothing-matches-this',
    });
    expect(report).toContain('2 sessions were discovered in total');
  });

  it('never calls endDay in a way that captures the excluded session (dry-run branch too)', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: true,
      session: alpha.sessionId,
    });
    expect(report).toContain('dry run');
    expect(report).toContain('alpha');
    expect(report).not.toContain('beta');
  });
});

describe('runEndDayCommand — Config threading', () => {
  it('passes the config through to formatting (e.g. termination policy shown for a dry-run preview)', async () => {
    const session = createSessionWithPid({
      hasTranscript: true,
      cwd: 'c:\\code\\p',
      lastActivity: NOW,
    });
    const config: Config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { 'c:\\code\\p': { canTerminate: true, deepCapture: false } },
    };
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage: new FakeStorage(config),
    });
    const report = await runEndDayCommand(deps, config, { dryRun: true });
    expect(report).toContain('would terminate: yes');
  });
});
