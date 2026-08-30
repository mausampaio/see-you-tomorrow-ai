import { describe, expect, it } from 'vitest';
import { formatEndDayReport } from '../../../src/cli/format-end-day.js';
import type {
  CapturedSession,
  EndDayResult,
  IneligibleSession,
} from '../../../src/application/types.js';
import type { Config, Handoff } from '../../../src/core/types.js';

/** Minimal, complete `Handoff` — same spirit as `core/briefing.test.ts`'s own `createHandoff`
 * (this file doesn't import that one: each test file keeps its own tiny fixture, the project's
 * existing convention — see e.g. `tests/unit/core/briefing.test.ts`). Synthetic UUID only. */
function createHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: 'c:\\code\\projeto',
    name: 'projeto-01',
    capturedAt: new Date('2026-08-16T21:00:00.000Z'),
    sessionState: 'ended',
    capturedDuringActiveTurn: false,
    source: 'model',
    captureMode: 'lean',
    sources: ['registry'],
    facts: { lastActivity: null, lastPrompts: [], touchedFiles: [], git: null },
    understanding: 'Refactored the parser.',
    pendingItems: [],
    tomorrowPlan: [],
    generationError: null,
    ...overrides,
  };
}

function captured(overrides: Partial<CapturedSession> = {}): CapturedSession {
  return { handoff: createHandoff(), terminated: false, ...overrides };
}

function ineligible(overrides: Partial<IneligibleSession> = {}): IneligibleSession {
  return {
    sessionId: '22222222-2222-4222-8222-222222222222',
    cwd: 'c:\\code\\ignorado',
    name: 'ignorado',
    reasons: ['ignoredCwd'],
    ...overrides,
  };
}

function buildResult(overrides: Partial<EndDayResult> = {}): EndDayResult {
  return {
    day: '2026-08-16',
    discoveredCount: 0,
    rejectedDiscoveries: [],
    ineligible: [],
    captured: [],
    failedCaptures: [],
    terminationNotices: [],
    dryRun: false,
    briefingPreview: null,
    sessionsInScope: 0,
    forkCleanup: null,
    forkCleanupError: null,
    ...overrides,
  };
}

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    endOfDayTime: null,
    leadTimesInMinutes: [30, 15],
    relevanceHours: 12,
    idleMinutes: 45,
    captureModel: 'sonnet',
    budgetPerSessionUsd: 0.25,
    captureConcurrency: 3,
    ignore: [],
    projectPolicy: {},
    forkCleanupDays: 7,
    ...overrides,
  };
}

describe('formatEndDayReport — header and discovery summary', () => {
  it('a real run has no dry-run suffix', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    expect(report).toContain('seeya end-day — 2026-08-16');
    expect(report).not.toContain('dry run');
  });

  it('a dry run names itself explicitly', () => {
    const report = formatEndDayReport(buildResult({ dryRun: true }), buildConfig());
    expect(report).toContain(
      'seeya end-day — 2026-08-16 (dry run — nothing is written or terminated)',
    );
  });

  it('reports discoveredCount and sessionsInScope, singular/plural correctly', () => {
    const report = formatEndDayReport(
      buildResult({ discoveredCount: 1, sessionsInScope: 1 }),
      buildConfig(),
    );
    expect(report).toContain('1 session discovered; 1 in scope.');
  });

  it('D-022: rejected discoveries are named, not just counted', () => {
    const report = formatEndDayReport(
      buildResult({
        discoveredCount: 2,
        sessionsInScope: 2,
        rejectedDiscoveries: [{ file: 'sessions/broken.json', raw: 'x', reason: 'not valid JSON' }],
      }),
      buildConfig(),
    );
    expect(report).toContain('2 sessions discovered, 1 entry ignored; 2 in scope.');
    expect(report).toContain('Ignored discovery entries:');
    expect(report).toContain('sessions/broken.json: not valid JSON');
  });
});

describe('formatEndDayReport — captured sessions', () => {
  it('a model-sourced capture shows its understanding text', () => {
    const report = formatEndDayReport(
      buildResult({ captured: [captured({ handoff: createHandoff({ understanding: 'did X' }) })] }),
      buildConfig(),
    );
    expect(report).toContain('- projeto-01 (c:\\code\\projeto)');
    expect(report).toContain('mode: lean | source: model');
    expect(report).toContain('Understanding: did X');
  });

  it('D-025/D-003: a deterministic capture names the failure, never fabricates understanding', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [
          captured({
            handoff: createHandoff({
              source: 'deterministic',
              understanding: '',
              generationError: 'claude exited with code 1',
            }),
          }),
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('source: deterministic');
    expect(report).toContain('Understanding not available: claude exited with code 1');
  });

  it('a real run shows the actual "terminated" outcome', () => {
    const config = buildConfig({
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
    });
    const report = formatEndDayReport(
      buildResult({ captured: [captured({ terminated: true })] }),
      config,
    );
    expect(report).toContain('terminated: yes');
  });

  it('a dry run shows "would terminate" derived from policy, never the (always-false) terminated field', () => {
    const config = buildConfig({
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
    });
    const report = formatEndDayReport(
      buildResult({ dryRun: true, captured: [captured({ terminated: false })] }),
      config,
    );
    expect(report).toContain('would terminate: yes');
    expect(report).not.toContain('terminated:');
  });

  it('a dry run never claims "would terminate: yes" for a session with no PID (sessionState: unknown)', () => {
    const config = buildConfig({
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
    });
    const report = formatEndDayReport(
      buildResult({
        dryRun: true,
        captured: [captured({ handoff: createHandoff({ sessionState: 'unknown' }) })],
      }),
      config,
    );
    expect(report).toContain('would terminate: no');
  });

  it('omits the whole "Captured" section when nothing was captured', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    expect(report).not.toContain('Captured:');
  });
});

describe('formatEndDayReport — ineligible, failed captures and termination notices', () => {
  it('lists ineligible sessions with their reasons', () => {
    const report = formatEndDayReport(
      buildResult({ ineligible: [ineligible({ reasons: ['ignoredCwd', 'noRecentActivity'] })] }),
      buildConfig(),
    );
    expect(report).toContain('Ineligible:');
    expect(report).toContain('- ignorado (c:\\code\\ignorado): ignoredCwd, noRecentActivity');
  });

  it('lists failed captures with the raw reason (AGENTS.md § "Mensagens de erro")', () => {
    const report = formatEndDayReport(
      buildResult({
        failedCaptures: [
          { sessionId: 's', cwd: 'c:\\code\\falhou', name: 'falhou', reason: 'disk is full' },
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('Failed captures:');
    expect(report).toContain('- falhou (c:\\code\\falhou): disk is full');
  });

  it('Q-007: names a termination notice explicitly, never silently', () => {
    const report = formatEndDayReport(
      buildResult({
        terminationNotices: [
          {
            sessionId: 's',
            cwd: 'c:\\code\\preso',
            name: 'preso',
            reason: 'terminateGracefully returned false; process pid 123 is still alive (Q-007)',
          },
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('Termination notices:');
    expect(report).toContain('- preso (c:\\code\\preso): terminateGracefully returned false');
  });

  it('omits all three sections when every bucket is empty', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    expect(report).not.toContain('Ineligible:');
    expect(report).not.toContain('Failed captures:');
    expect(report).not.toContain('Termination notices:');
  });
});

describe('formatEndDayReport — fork cleanup (D-012)', () => {
  it('a dry run always reports the cleanup as skipped, never a preview', () => {
    const report = formatEndDayReport(buildResult({ dryRun: true }), buildConfig());
    expect(report).toContain('Fork cleanup: skipped (a dry run never deletes files, D-012).');
  });

  it('a real run with nothing stale says so plainly', () => {
    const report = formatEndDayReport(
      buildResult({ forkCleanup: { outcomes: [], rejected: [] } }),
      buildConfig(),
    );
    expect(report).toContain('Fork cleanup: nothing to clean up.');
  });

  it('summarizes deleted/alreadyAbsent/failed outcomes and rejected registry entries', () => {
    const report = formatEndDayReport(
      buildResult({
        forkCleanup: {
          outcomes: [
            { sessionId: 'a', outcome: 'deleted' },
            { sessionId: 'b', outcome: 'alreadyAbsent' },
            { sessionId: 'c', outcome: 'failed', reason: 'EPERM' },
          ],
          rejected: [{ file: 'forks.json', raw: 'x', reason: 'corrupted entry' }],
        },
      }),
      buildConfig(),
    );
    expect(report).toContain(
      'Fork cleanup: 1 fork deleted, 1 entry already absent, 1 fork failed to delete.',
    );
    expect(report).toContain('1 entry in forks.json ignored.');
  });

  it('a cleanup that itself failed reports the raw error, never silently', () => {
    const report = formatEndDayReport(
      buildResult({ forkCleanupError: 'forks.json is unwritable' }),
      buildConfig(),
    );
    expect(report).toContain('Fork cleanup: failed — forks.json is unwritable');
  });
});

describe('formatEndDayReport — briefing section', () => {
  it('a dry run prints the full preview markdown, never claims to have written', () => {
    const report = formatEndDayReport(
      buildResult({ dryRun: true, briefingPreview: '# Daily briefing — 2026-08-16\n' }),
      buildConfig(),
    );
    expect(report).toContain('Briefing preview (not written):');
    expect(report).toContain('# Daily briefing — 2026-08-16');
    expect(report).not.toContain('Wrote ');
  });

  it('a real run confirms the write with a count, singular/plural correctly', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [captured(), captured({ handoff: createHandoff({ sessionId: 'x' }) })],
      }),
      buildConfig(),
    );
    expect(report).toContain('Wrote 2 handoffs and the daily briefing (summary.md).');
  });
});
