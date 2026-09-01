/**
 * `buildEndDayNotice` (S4-T1, docs/ESPECIFICACAO.md § `seeya end-day` step 5). Q-007's own
 * requirement — the notice names the session, the reason, and says the handoff was saved — is the
 * one this file most needs to prove, since docs/PLANO-DE-ENTREGA.md names it explicitly for S4-T1.
 */
import { describe, expect, it } from 'vitest';
import { buildEndDayNotice } from '../../../src/cli/end-day-notice.js';
import type {
  CapturedSession,
  EndDayResult,
  TerminationNotice,
} from '../../../src/application/types.js';
import type { Handoff } from '../../../src/core/types.js';

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
    facts: {
      lastActivity: null,
      lastPrompts: [],
      assistantMessages: [],
      touchedFiles: [],
      git: null,
    },
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

function terminationNotice(overrides: Partial<TerminationNotice> = {}): TerminationNotice {
  return {
    sessionId: '33333333-3333-4333-8333-333333333333',
    cwd: 'c:\\code\\agente-autonomo',
    name: 'agente-autonomo',
    reason: 'terminateGracefully returned false; process pid 4242 is still alive (Q-007)',
    ...overrides,
  };
}

function buildResult(overrides: Partial<EndDayResult> = {}): EndDayResult {
  return {
    day: '2026-08-16',
    scope: { kind: 'fullDay' },
    discoveredCount: 0,
    rejectedDiscoveries: [],
    ineligible: [],
    captured: [],
    failedCaptures: [],
    terminationNotices: [],
    dryRun: false,
    briefingPreview: null,
    sessionsInScope: 0,
    listedSessions: [],
    forkCleanup: null,
    forkCleanupError: null,
    ...overrides,
  };
}

describe('buildEndDayNotice — dry run', () => {
  it('is null for a dry run — a preview is not "encerramento executado"', () => {
    const result = buildResult({ dryRun: true, captured: [captured()] });
    expect(buildEndDayNotice(result)).toBeNull();
  });
});

describe('buildEndDayNotice — the clean case', () => {
  it('names the day and how many sessions were captured, no "(with issues)" suffix', () => {
    const result = buildResult({ captured: [captured(), captured()] });
    const notice = buildEndDayNotice(result);
    expect(notice).not.toBeNull();
    expect(notice?.title).toBe('seeya end-day: 2026-08-16');
    expect(notice?.body).toContain('2 sessions captured.');
  });

  it('uses the singular for exactly one captured session', () => {
    const result = buildResult({ captured: [captured()] });
    expect(buildEndDayNotice(result)?.body).toContain('1 session captured.');
  });
});

describe('buildEndDayNotice — failed captures', () => {
  it('marks the title "(with issues)" and names the failure count', () => {
    const result = buildResult({
      captured: [captured()],
      failedCaptures: [
        { sessionId: 'x', cwd: 'c:\\code\\x', name: 'x', reason: 'git worktree list failed' },
      ],
    });
    const notice = buildEndDayNotice(result);
    expect(notice?.title).toBe('seeya end-day: 2026-08-16 (with issues)');
    expect(notice?.body).toContain('1 capture failed');
    expect(notice?.body).toContain('see the terminal report');
  });
});

describe('buildEndDayNotice — Q-007 termination notices', () => {
  it('names the session, the reason, and says the handoff was saved', () => {
    const result = buildResult({
      captured: [captured()],
      terminationNotices: [terminationNotice()],
    });
    const notice = buildEndDayNotice(result);

    expect(notice?.title).toBe('seeya end-day: 2026-08-16 (with issues)');
    // The three things Q-007 requires, all in the same message: WHICH session, WHY, and that the
    // handoff itself was fine.
    expect(notice?.body).toContain('"agente-autonomo"');
    expect(notice?.body).toContain('was NOT terminated');
    expect(notice?.body).toContain('process pid 4242 is still alive');
    expect(notice?.body).toContain('handoff was saved successfully');
    expect(notice?.body).toContain('only the termination did not happen');
  });

  it('names every session with a termination notice, not just the first', () => {
    const result = buildResult({
      terminationNotices: [
        terminationNotice({ name: 'first', sessionId: 'a' }),
        terminationNotice({ name: 'second', sessionId: 'b' }),
      ],
    });
    const notice = buildEndDayNotice(result);
    expect(notice?.body).toContain('"first"');
    expect(notice?.body).toContain('"second"');
  });
});
