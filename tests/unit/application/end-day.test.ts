import { describe, expect, it } from 'vitest';
import { endDay } from '../../../src/application/end-day.js';
import { createSessionWithPid, createSessionWithoutPid } from '../core/_fixtures.js';
import type { RejectedDiscoveryRecord } from '../../../src/core/ports.js';
import type { Config, Day, Handoff } from '../../../src/core/types.js';
import {
  DEFAULT_TEST_CONFIG,
  FailingForkCleanup,
  FakeClock,
  FakeForkCleanup,
  FakeGitReader,
  FakeProcessControl,
  FakeSessionProvider,
  FakeStorage,
  FakeTranscriptReader,
  StorageWithRejectedHandoffs,
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
    forkCleanup: new FakeForkCleanup(),
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
    // `createSessionWithPid`, not `createSessionWithoutPid`: since D-031 (S4-T0b), a session with
    // no PID never reaches eligibility at all — it's out of capture scope entirely, not merely
    // ineligible (see the "endDay — D-031 scope cut" suite below). `noEvidence` is still reachable
    // through the full `endDay` pipeline via a `SessionWithPid` whose `lastActivity` is `null`.
    const session = createSessionWithPid({ hasTranscript: false, lastActivity: null });
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
        source: 'model',
        captureMode: 'lean',
        sources: ['git'],
        facts: {
          lastActivity: null,
          lastPrompts: [],
          assistantMessages: [],
          touchedFiles: [],
          git: [{ root: session.cwd, ...unchangedGitFacts }],
          filesOutsideRepository: 0,
          reposNotVisited: 0,
        },
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

describe('endDay — D-031 scope cut (S4-T0b)', () => {
  it(
    'a transcript-only session (unknown, no PID) is never captured and appears in ' +
      'listedSessions with its title and last prompt instead',
    async () => {
      const session = createSessionWithoutPid({
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: 'c:\\code\\fechada',
        name: 'fechada-01',
        lastActivity: NOW,
      });
      const transcriptReader = new FakeTranscriptReader(
        new Map(),
        new Set(),
        new Map([
          [session.sessionId, { aiTitle: 'Refactor the parser', lastPrompt: 'run the tests' }],
        ]),
      );
      const deps = buildDeps({
        sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
        transcriptReader,
      });
      const result = await endDay(deps);
      expect(result.captured).toHaveLength(0);
      expect(result.ineligible).toHaveLength(0);
      expect(result.failedCaptures).toHaveLength(0);
      expect(result.discoveredCount).toBe(1);
      expect(result.sessionsInScope).toBe(0);
      expect(result.listedSessions).toEqual([
        {
          sessionId: session.sessionId,
          cwd: session.cwd,
          name: session.name,
          info: { kind: 'read', aiTitle: 'Refactor the parser', lastPrompt: 'run the tests' },
        },
      ]);
    },
  );

  it(
    'a registered session with a dead PID (ended) IS captured — the line D-031 says looks like ' +
      'a concession and is not',
    async () => {
      const session = createSessionWithPid({ processIsAlive: false, lastActivity: NOW });
      const deps = buildDeps({
        sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      });
      const result = await endDay(deps);
      expect(result.captured).toHaveLength(1);
      expect(result.captured[0]?.handoff.sessionId).toBe(session.sessionId);
      expect(result.captured[0]?.handoff.sessionState).toBe('ended');
      expect(result.listedSessions).toHaveLength(0);
    },
  );

  it('listedSessions is unaffected by --session: it always reflects the full discovery pass', async () => {
    const captureCandidate = createSessionWithPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\candidata',
      lastActivity: NOW,
    });
    const listedOnly = createSessionWithoutPid({
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: 'c:\\code\\fechada',
      name: 'fechada-02',
      lastActivity: NOW,
    });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({
        sessions: [captureCandidate, listedOnly],
        rejected: [],
      }),
    });
    const result = await endDay(deps, {
      sessionFilter: (session) => session.sessionId === captureCandidate.sessionId,
    });
    expect(result.captured).toHaveLength(1);
    expect(result.sessionsInScope).toBe(1);
    expect(result.listedSessions).toHaveLength(1);
    expect(result.listedSessions[0]?.sessionId).toBe(listedOnly.sessionId);
  });

  it(
    "the day's briefing shows captured handoffs and D-031's listing in separate sections, " +
      'never mixed together',
    async () => {
      const captured = createSessionWithPid({
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: 'c:\\code\\viva',
        name: 'viva-01',
        lastActivity: NOW,
      });
      const listed = createSessionWithoutPid({
        sessionId: '22222222-2222-4222-8222-222222222222',
        cwd: 'c:\\code\\fechada',
        name: 'fechada-03',
        lastActivity: NOW,
      });
      const transcriptReader = new FakeTranscriptReader(
        new Map(),
        new Set(),
        new Map([[listed.sessionId, { aiTitle: 'Closed session title', lastPrompt: null }]]),
      );
      const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
      const deps = buildDeps({
        sessionProvider: new FakeSessionProvider({ sessions: [captured, listed], rejected: [] }),
        storage,
        transcriptReader,
      });
      const result = await endDay(deps);
      const markdown = storage.savedBriefings.get(result.day);
      expect(markdown).toContain('## viva-01');
      expect(markdown).toContain('## Not captured (closed sessions)');
      expect(markdown).toContain('fechada-03');
      expect(markdown).toContain('Closed session title');
      // The listed session never gets its own `## <name>` handoff header — that header style is
      // reserved for actual captures (`core/briefing.ts#renderHandoffSection`).
      expect(markdown).not.toContain('## fechada-03');
    },
  );
});

describe('endDay — EndDayScope (S4-T0c)', () => {
  it('with no options.scope at all, result.scope resolves to fullDay (the ordinary case)', async () => {
    const deps = buildDeps();
    const result = await endDay(deps);
    expect(result.scope).toEqual({ kind: 'fullDay' });
  });

  it(
    "options.scope's sessionValue is carried straight through unmodified; endDay adds the " +
      'discard counts itself (S4-T0d)',
    async () => {
      const deps = buildDeps();
      const result = await endDay(deps, {
        scope: { kind: 'singleSession', sessionValue: 'code-6d' },
      });
      // No sessions discovered at all here, so both counts are 0 — see the dedicated
      // "discard counts" suite below for the case that actually has something to discard.
      expect(result.scope).toEqual({
        kind: 'singleSession',
        sessionValue: 'code-6d',
        captureCandidateCount: 0,
        consideredCount: 0,
      });
    },
  );

  it(
    'aceite: a --session-scoped run and a later full-day run on the SAME day produce two ' +
      'summary.md distinguishable by reading, not by comparing counts',
    async () => {
      const onlySession = createSessionWithPid({
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: 'c:\\code\\so-esta',
        lastActivity: NOW,
      });
      const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
      const deps = buildDeps({
        sessionProvider: new FakeSessionProvider({ sessions: [onlySession], rejected: [] }),
        storage,
      });

      const narrowedResult = await endDay(deps, {
        sessionFilter: (session) => session.sessionId === onlySession.sessionId,
        scope: { kind: 'singleSession', sessionValue: 'so-esta' },
      });
      const narrowedMarkdown = storage.savedBriefings.get(narrowedResult.day);
      expect(narrowedResult.captured).toHaveLength(1);

      // Same underlying data run again as a full day — D-026's anti-duplication may or may not
      // recapture the same session (unchanged evidence), which is exactly why the aceite says
      // "not by comparing counts": the scope note has to differ regardless of what got captured.
      const fullResult = await endDay(deps);
      const fullMarkdown = storage.savedBriefings.get(fullResult.day);

      expect(narrowedMarkdown).toContain('narrowed by `--session "so-esta"`');
      expect(fullMarkdown).toContain('full day — every discovered session was considered');
      expect(fullMarkdown).not.toContain('narrowed by');
      expect(narrowedMarkdown).not.toEqual(fullMarkdown);
    },
  );
});

describe('endDay — scope note reports the discard count (S4-T0d)', () => {
  it(
    'the denominator is capture candidates, never discoveredCount: with all three D-031 ' +
      'populations present (one captured, one discarded by the filter, one closed) the note ' +
      'reads 1 of 2 — not 1 of 3',
    async () => {
      // The case the task's own brief calls out as the one that would actually catch the bug:
      // with only two populations, a wrong "discoveredCount" denominator can still look plausible.
      // It takes all three at once — a capture candidate that WAS considered, one that was NOT
      // (discarded by --session), and a closed session that was never a capture candidate to begin
      // with — to tell a correct denominator (captureCandidateCount, D-031) from a wrong one that
      // silently folds the closed session in as though the filter could have discarded it too.
      const considered = createSessionWithPid({
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: 'c:\\code\\considerada',
        lastActivity: NOW,
      });
      const discardedByFilter = createSessionWithPid({
        sessionId: '22222222-2222-4222-8222-222222222222',
        cwd: 'c:\\code\\descartada',
        lastActivity: NOW,
      });
      const closed = createSessionWithoutPid({
        sessionId: '33333333-3333-4333-8333-333333333333',
        cwd: 'c:\\code\\fechada',
        name: 'fechada-01',
        lastActivity: NOW,
      });
      const deps = buildDeps({
        sessionProvider: new FakeSessionProvider({
          sessions: [considered, discardedByFilter, closed],
          rejected: [],
        }),
      });

      const result = await endDay(deps, {
        sessionFilter: (session) => session.sessionId === considered.sessionId,
        scope: { kind: 'singleSession', sessionValue: 'considerada' },
      });

      // discoveredCount is 3 (all three sessions) — the wrong denominator this test guards
      // against. The right one, captureCandidateCount, is 2: `closed` has no PID at all, so it was
      // never a capture candidate `--session` could have discarded (D-031).
      expect(result.discoveredCount).toBe(3);
      expect(result.scope).toEqual({
        kind: 'singleSession',
        sessionValue: 'considerada',
        captureCandidateCount: 2,
        consideredCount: 1,
      });
      expect(result.listedSessions).toHaveLength(1);
      expect(result.listedSessions[0]?.sessionId).toBe(closed.sessionId);
    },
  );

  it('a full day never carries discard counts to report — there was no filter to discard against', async () => {
    const session = createSessionWithPid({ lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const result = await endDay(deps);
    expect(result.scope).toEqual({ kind: 'fullDay' });
  });
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
    // `createSessionWithPid`, not `createSessionWithoutPid` (D-031, S4-T0b): a `SessionWithoutPid`
    // is out of capture scope entirely regardless of evidence — see the "endDay — D-031 scope cut"
    // suite below. `hasTranscript: false` on a REGISTERED session is D-013's real scenario (the
    // autonomous execution agent, transcript suppressed by an inherited child-session marker),
    // which is exactly what this test's own aceite is about: only git responds.
    const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
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
    // `registry` also answers here (unlike before this test used `createSessionWithoutPid`):
    // `session.hasPid` alone means the registry answered (`evidence-gathering.ts#gatherEvidence`),
    // regardless of whether the transcript did — this test's own aceite is about the ABSENCE of
    // `transcript`, which `hasTranscript: false` still proves.
    expect(result.captured[0]?.handoff.sources).toEqual(['git', 'registry']);
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

describe('endDay — briefing (S2-T4)', () => {
  it('writes a consolidated summary.md for the day, reflecting a captured session', async () => {
    const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage,
      gitReader: new FakeGitReader(
        new Map([
          [
            session.cwd,
            {
              hasGit: true,
              facts: {
                branch: 'main',
                dirty: false,
                modifiedFiles: [],
                commitsToday: [],
                worktrees: [],
              },
              rejectedWorktrees: [],
            },
          ],
        ]),
      ),
    });
    const result = await endDay(deps);
    const markdown = storage.savedBriefings.get(result.day);
    expect(markdown).toBeDefined();
    expect(markdown).toContain(session.name);
    expect(markdown).toContain('1 session captured today');
  });

  it('writes an honest, empty-day briefing when nothing was discovered (aceite #5)', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [], rejected: [] }),
      storage,
    });
    const result = await endDay(deps);
    expect(storage.savedBriefings.get(result.day)).toContain('No sessions were captured today.');
  });

  it("surfaces a corrupted handoff file from a PREVIOUS capture today, not just this run's own (D-022)", async () => {
    const storage = new StorageWithRejectedHandoffs(DEFAULT_TEST_CONFIG, {
      file: 'sessions/broken.json',
      raw: undefined,
      reason: 'not valid JSON',
    });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [], rejected: [] }),
      storage,
    });
    const result = await endDay(deps);
    const markdown = storage.savedBriefings.get(result.day);
    expect(markdown).toContain('1 entry could not be read');
    expect(markdown).toContain('sessions/broken.json');
  });
});

describe('endDay — --session filtering (S2-T5)', () => {
  it('sessionFilter narrows which sessions are captured, leaving the others out of every bucket', async () => {
    const kept = createSessionWithPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\mantido',
      lastActivity: NOW,
    });
    const skipped = createSessionWithPid({
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: 'c:\\code\\pulado',
      lastActivity: NOW,
    });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [kept, skipped], rejected: [] }),
    });
    const result = await endDay(deps, {
      sessionFilter: (session) => session.sessionId === kept.sessionId,
    });
    expect(result.captured).toHaveLength(1);
    expect(result.captured[0]?.handoff.sessionId).toBe(kept.sessionId);
    expect(result.ineligible).toHaveLength(0);
    expect(result.failedCaptures).toHaveLength(0);
    // `discoveredCount` is the TOTAL discovery saw, unaffected by the filter — only
    // `sessionsInScope` narrows, so "0 sessions found" and "0 sessions matched --session" stay
    // distinguishable to whoever reads the result (cli/, S2-T5).
    expect(result.discoveredCount).toBe(2);
    expect(result.sessionsInScope).toBe(1);
  });

  it('a filter matching nothing captures nothing and reports sessionsInScope: 0', async () => {
    const session = createSessionWithPid({ lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const result = await endDay(deps, { sessionFilter: () => false });
    expect(result.captured).toHaveLength(0);
    expect(result.discoveredCount).toBe(1);
    expect(result.sessionsInScope).toBe(0);
  });

  it('with no sessionFilter, every discovered session is in scope (unchanged default behavior)', async () => {
    const session = createSessionWithPid({ lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const result = await endDay(deps);
    expect(result.sessionsInScope).toBe(1);
    expect(result.dryRun).toBe(false);
  });
});

describe('endDay — --dry-run (S2-T5)', () => {
  it('writes no handoff and no briefing, but still returns a captured preview', async () => {
    const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage,
      gitReader: new FakeGitReader(
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
      ),
    });
    const result = await endDay(deps, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.captured).toHaveLength(1);
    expect(storage.savedHandoffs.size).toBe(0);
    expect(storage.savedBriefings.size).toBe(0);
    expect(result.briefingPreview).not.toBeNull();
    expect(result.briefingPreview).toContain(session.name);
  });

  it('a real run leaves briefingPreview null — the markdown is on disk instead', async () => {
    const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const result = await endDay(deps);
    expect(result.dryRun).toBe(false);
    expect(result.briefingPreview).toBeNull();
  });

  it(
    "briefingPreview consolidates a PREVIOUSLY saved handoff with this dry run's own fresh one, " +
      'the same way a real re-run would (application/briefing.ts#previewDailyBriefing)',
    async () => {
      const earlier = createSessionWithPid({
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: 'c:\\code\\mais-cedo',
        lastActivity: NOW,
      });
      const later = createSessionWithPid({
        sessionId: '22222222-2222-4222-8222-222222222222',
        cwd: 'c:\\code\\mais-tarde',
        lastActivity: NOW,
      });
      const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
      await storage.saveHandoff('2026-08-16', {
        sessionId: earlier.sessionId,
        cwd: earlier.cwd,
        name: earlier.name,
        capturedAt: NOW,
        sessionState: 'alive',
        capturedDuringActiveTurn: false,
        source: 'model',
        captureMode: 'lean',
        sources: ['registry'],
        facts: {
          lastActivity: null,
          lastPrompts: [],
          assistantMessages: [],
          touchedFiles: [],
          git: [],
          filesOutsideRepository: 0,
          reposNotVisited: 0,
        },
        understanding: 'earlier work',
        pendingItems: [],
        tomorrowPlan: [],
        generationError: null,
      });
      const deps = buildDeps({
        sessionProvider: new FakeSessionProvider({ sessions: [later], rejected: [] }),
        storage,
      });
      const result = await endDay(deps, { dryRun: true });
      expect(result.briefingPreview).toContain(earlier.name);
      expect(result.briefingPreview).toContain(later.name);
      // Still not written: the preview reads what's on disk, it never adds to it.
      expect(storage.savedBriefings.size).toBe(0);
    },
  );

  it('never attempts termination, even for a canTerminate: true session with a live PID', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { [session.cwd]: { canTerminate: true, deepCapture: false } },
    };
    let terminateCalled = false;
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage: new FakeStorage(config),
      processControl: new FakeProcessControl(() => {
        terminateCalled = true;
        return true;
      }),
    });
    const result = await endDay(deps, { dryRun: true });
    expect(terminateCalled).toBe(false);
    expect(result.captured[0]?.terminated).toBe(false);
    expect(result.terminationNotices).toHaveLength(0);
  });

  it('skips fork cleanup entirely — forkCleanup is null, never a preview', async () => {
    let cleanupCalled = false;
    class SpyForkCleanup extends FakeForkCleanup {
      override cleanup(forkCleanupDays: number): ReturnType<FakeForkCleanup['cleanup']> {
        cleanupCalled = true;
        return super.cleanup(forkCleanupDays);
      }
    }
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [], rejected: [] }),
      forkCleanup: new SpyForkCleanup(),
    });
    const result = await endDay(deps, { dryRun: true });
    expect(cleanupCalled).toBe(false);
    expect(result.forkCleanup).toBeNull();
    expect(result.forkCleanupError).toBeNull();
  });
});

describe('endDay — fork cleanup wiring (D-012, S2-T5)', () => {
  it('runs ForkCleanup.cleanup() with config.forkCleanupDays on a real run and reports its result', async () => {
    const cleanupResult = {
      outcomes: [
        { sessionId: '11111111-1111-4111-8111-111111111111', outcome: 'deleted' as const },
      ],
      rejected: [],
    };
    let receivedDays: number | undefined;
    class RecordingForkCleanup extends FakeForkCleanup {
      constructor() {
        super(cleanupResult);
      }
      override cleanup(days: number): ReturnType<FakeForkCleanup['cleanup']> {
        receivedDays = days;
        return super.cleanup(days);
      }
    }
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [], rejected: [] }),
      storage: new FakeStorage({ ...DEFAULT_TEST_CONFIG, forkCleanupDays: 9 }),
      forkCleanup: new RecordingForkCleanup(),
    });
    const result = await endDay(deps);
    expect(receivedDays).toBe(9);
    expect(result.forkCleanup).toEqual(cleanupResult);
    expect(result.forkCleanupError).toBeNull();
  });

  it('a ForkCleanup that throws is isolated: captures/briefing already done still stand', async () => {
    const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage,
      forkCleanup: new FailingForkCleanup(),
    });
    const result = await endDay(deps);
    expect(result.captured).toHaveLength(1);
    expect(storage.savedBriefings.get(result.day)).toBeDefined();
    expect(result.forkCleanup).toBeNull();
    expect(result.forkCleanupError).toMatch(/cleanup always fails/);
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
