import { describe, expect, it } from 'vitest';
import { endDay } from '../../../src/application/end-day.js';
import { createSessionWithPid, createSessionWithoutPid } from '../core/_fixtures.js';
import type { RejectedDiscoveryRecord } from '../../../src/core/ports.js';
import type { Config, Day, Handoff } from '../../../src/core/types.js';
import {
  DEFAULT_TEST_CONFIG,
  FakeClock,
  FakeGitReader,
  FakeProcessControl,
  FakeSessionProvider,
  FakeStorage,
  FakeTranscriptReader,
  failingGenerator,
  succeedingGenerator,
} from './_fakes.js';
import type { EndDayDeps } from '../../../src/application/types.js';

const NOW = new Date('2026-08-16T21:00:00.000Z');

/** Rejects `readHandoff` for exactly one `sessionId`, succeeding normally for every other one —
 * the per-session failure isolation test (aceite #3) needs ONE session to fail while proving the
 * others still complete, which a blanket-failing double couldn't show. */
class SingleSessionFailureStorage extends FakeStorage {
  constructor(
    config: Config,
    private readonly failingSessionId: string,
  ) {
    super(config);
  }

  override readHandoff(day: Day, sessionId: string): Promise<Handoff | null> {
    if (sessionId === this.failingSessionId) {
      return Promise.reject(new Error('storage is on fire for this one session'));
    }
    return super.readHandoff(day, sessionId);
  }
}

/** Tracks how many `readHandoff` calls are in flight at once — the concurrency-limit test
 * (docs/PLANO-DE-ENTREGA.md S2-T3: "concorrência limitada") needs an observable overlap, not just
 * a final count. */
class ConcurrencyTrackingStorage extends FakeStorage {
  private inFlight = 0;
  maxInFlight = 0;

  override async readHandoff(day: Day, sessionId: string): Promise<Handoff | null> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.inFlight -= 1;
    return super.readHandoff(day, sessionId);
  }
}

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
    ...overrides,
  };
}

describe('endDay — day and discovery bookkeeping', () => {
  it('computes the local day string from the injected Clock (D-019)', async () => {
    const deps = buildDeps();
    const result = await endDay(deps);
    expect(result.day).toBe('2026-08-16');
  });

  it('reports discoveredCount and passes discovery rejections through unchanged (D-022)', async () => {
    const rejected: RejectedDiscoveryRecord[] = [
      { file: 'sessions/broken.json', raw: '{bad', reason: 'not valid JSON' },
    ];
    const session = createSessionWithPid({ lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected }),
    });
    const result = await endDay(deps);
    expect(result.discoveredCount).toBe(1);
    expect(result.rejectedDiscoveries).toEqual(rejected);
  });
});

describe('endDay — eligibility filtering', () => {
  it('an ignored session never reaches capture and is reported ineligible with its reason', async () => {
    const session = createSessionWithPid({ cwd: 'c:\\code\\rascunhos', lastActivity: NOW });
    const config = { ...DEFAULT_TEST_CONFIG, ignore: ['c:\\code\\rascunhos'] };
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage: new FakeStorage(config),
    });
    const result = await endDay(deps);
    expect(result.captured).toHaveLength(0);
    expect(result.ineligible).toEqual([
      {
        sessionId: session.sessionId,
        cwd: session.cwd,
        name: session.name,
        reasons: ['ignoredCwd'],
      },
    ]);
  });

  it('a session with no evidence at all is reported ineligible, not a capture failure', async () => {
    const session = createSessionWithoutPid({ hasTranscript: false, lastActivity: null });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const result = await endDay(deps);
    expect(result.captured).toHaveLength(0);
    expect(result.failedCaptures).toHaveLength(0);
    expect(result.ineligible[0]?.reasons).toEqual(['noEvidence']);
  });

  it(
    'a duplicate found only by the FULL check (D-026, after fresh evidence was gathered) is ' +
      'reported ineligible through the whole endDay pipeline, not just captureSession directly',
    async () => {
      const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
      const unchangedGitFacts = {
        branch: 'main',
        dirty: false,
        modifiedFiles: [],
        commitsToday: [],
        worktrees: [],
      };
      const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
      await storage.saveHandoff('2026-08-16', {
        sessionId: session.sessionId,
        cwd: session.cwd,
        name: session.name,
        capturedAt: NOW,
        sessionState: 'alive',
        capturedDuringActiveTurn: false,
        source: 'noTranscript',
        captureMode: 'lean',
        sources: ['git'],
        facts: { lastActivity: null, lastPrompts: [], touchedFiles: [], git: unchangedGitFacts },
        understanding: '',
        pendingItems: [],
        tomorrowPlan: [],
        generationError: null,
      });
      const gitReader = new FakeGitReader(
        new Map([[session.cwd, { hasGit: true, facts: unchangedGitFacts, rejectedWorktrees: [] }]]),
      );
      const deps = buildDeps({
        sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
        storage,
        gitReader,
      });
      const result = await endDay(deps);
      expect(result.captured).toHaveLength(0);
      expect(result.failedCaptures).toHaveLength(0);
      expect(result.ineligible).toEqual([
        {
          sessionId: session.sessionId,
          cwd: session.cwd,
          name: session.name,
          reasons: ['duplicateToday'],
        },
      ]);
    },
  );
});

describe('endDay — per-session failure isolation (aceite #3)', () => {
  it('one session throwing during capture does not prevent another from completing', async () => {
    const good = createSessionWithPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\bom',
      lastActivity: NOW,
    });
    const bad = createSessionWithPid({
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: 'c:\\code\\ruim',
      lastActivity: NOW,
    });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [good, bad], rejected: [] }),
      storage: new SingleSessionFailureStorage(DEFAULT_TEST_CONFIG, bad.sessionId),
    });
    const result = await endDay(deps);
    expect(result.captured).toHaveLength(1);
    expect(result.captured[0]?.handoff.sessionId).toBe(good.sessionId);
    expect(result.failedCaptures).toHaveLength(1);
    expect(result.failedCaptures[0]?.sessionId).toBe(bad.sessionId);
    expect(result.failedCaptures[0]?.reason).toMatch(/storage is on fire/);
  });
});

describe('endDay — fallback and multi-source (aceite #1, #2)', () => {
  it('a session with only git responding still produces a valid, captured handoff', async () => {
    const session = createSessionWithoutPid({ hasTranscript: false, lastActivity: NOW });
    const gitReader = new FakeGitReader(
      new Map([
        [
          session.cwd,
          {
            hasGit: true,
            facts: {
              branch: 'main',
              dirty: true,
              modifiedFiles: ['a.ts'],
              commitsToday: [],
              worktrees: [],
            },
            rejectedWorktrees: [],
          },
        ],
      ]),
    );
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      gitReader,
    });
    const result = await endDay(deps);
    expect(result.captured).toHaveLength(1);
    expect(result.captured[0]?.handoff.sources).toEqual(['git']);
  });

  it('generation failure produces a "deterministic" handoff, not a dropped session (D-003)', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      leanGenerator: failingGenerator('claude binary not found'),
    });
    const result = await endDay(deps);
    expect(result.captured).toHaveLength(1);
    expect(result.captured[0]?.handoff.source).toBe('deterministic');
    expect(result.captured[0]?.handoff.generationError).toBe('claude binary not found');
  });
});

describe('endDay — Q-007 termination notices', () => {
  it('names the session and reason when a canTerminate session stays alive', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { [session.cwd]: { canTerminate: true, deepCapture: false } },
    };
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage: new FakeStorage(config),
      processControl: new FakeProcessControl(() => false),
    });
    const result = await endDay(deps);
    expect(result.captured[0]?.terminated).toBe(false);
    expect(result.terminationNotices).toHaveLength(1);
    expect(result.terminationNotices[0]).toMatchObject({
      sessionId: session.sessionId,
      cwd: session.cwd,
      name: session.name,
    });
    expect(result.terminationNotices[0]?.reason).toMatch(/still alive/);
  });

  it('a successful termination produces no notice at all', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { [session.cwd]: { canTerminate: true, deepCapture: false } },
    };
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage: new FakeStorage(config),
      processControl: new FakeProcessControl(() => true),
    });
    const result = await endDay(deps);
    expect(result.captured[0]?.terminated).toBe(true);
    expect(result.terminationNotices).toHaveLength(0);
  });
});

describe('endDay — concurrency limit', () => {
  it('never runs more session pipelines than captureConcurrency at once', async () => {
    const sessions = Array.from({ length: 6 }, (_, i) =>
      createSessionWithPid({
        sessionId: `1${i}111111-1111-4111-8111-11111111111${i}`,
        cwd: `c:\\code\\projeto-${i}`,
        lastActivity: NOW,
      }),
    );
    const config = { ...DEFAULT_TEST_CONFIG, captureConcurrency: 2 };
    const storage = new ConcurrencyTrackingStorage(config);
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions, rejected: [] }),
      storage,
    });
    await endDay(deps);
    expect(storage.maxInFlight).toBeLessThanOrEqual(2);
  });
});
