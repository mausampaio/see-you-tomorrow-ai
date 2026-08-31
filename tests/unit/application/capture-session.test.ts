import { describe, expect, it } from 'vitest';
import { captureSession } from '../../../src/application/capture-session.js';
import { createSessionWithPid, createSessionWithoutPid } from '../core/_fixtures.js';
import {
  DEFAULT_TEST_CONFIG,
  FailingSaveStorage,
  FakeForkCleanup,
  FakeGitReader,
  FakeProcessControl,
  FakeStorage,
  FakeTranscriptReader,
  UnverifiableSaveStorage,
  failingGenerator,
  succeedingGenerator,
} from './_fakes.js';
import type { EndDayDeps } from '../../../src/application/types.js';
import type { Config, Day, Handoff } from '../../../src/core/types.js';

/** Records the ORDER `saveHandoff`/`readHandoff` are called in, into a shared array — proves
 * D-002's "handoff gravado e verificado em disco → só então terminar o processo" by execution,
 * not by reading the implementation. `FakeProcessControl`'s callback pushes `'terminate'` into
 * the same array, so one assertion on the array proves the full order across two different
 * fakes. */
class OrderRecordingStorage extends FakeStorage {
  constructor(
    config: Config,
    private readonly calls: string[],
  ) {
    super(config);
  }

  override async saveHandoff(day: Day, handoff: Handoff): Promise<void> {
    this.calls.push('save');
    await super.saveHandoff(day, handoff);
  }

  override async readHandoff(day: Day, sessionId: string): Promise<Handoff | null> {
    this.calls.push('read');
    return super.readHandoff(day, sessionId);
  }
}

const NOW = new Date('2026-08-16T21:00:00.000Z');
const DAY = '2026-08-16';

function buildDeps(overrides: Partial<EndDayDeps> = {}): EndDayDeps {
  return {
    sessionProvider: { list: () => Promise.reject(new Error('not exercised')) },
    transcriptReader: new FakeTranscriptReader(),
    gitReader: new FakeGitReader(),
    leanGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    deepGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    storage: new FakeStorage(DEFAULT_TEST_CONFIG),
    processControl: new FakeProcessControl(),
    clock: { now: () => NOW },
    forkCleanup: new FakeForkCleanup(),
    ...overrides,
  };
}

describe('captureSession — handoff assembly', () => {
  it(
    'returns "ineligible" (not a written handoff) when the full check finds a duplicate — the ' +
      'cheap stage cannot see this, only the full one can (D-026)',
    async () => {
      const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
      // Unchanged git facts on both sides is what makes this a REAL duplicate (D-026: sameEvidence
      // needs at least one source to positively confirm — two captures with nothing but nulls on
      // both sides confirm nothing, they don't confirm "unchanged", see evidence.test.ts).
      const unchangedGitFacts = {
        branch: 'main',
        dirty: false,
        modifiedFiles: [],
        commitsToday: [],
        worktrees: [],
      };
      const facts = {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: unchangedGitFacts,
      };
      const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
      await storage.saveHandoff(DAY, {
        sessionId: session.sessionId,
        cwd: session.cwd,
        name: session.name,
        capturedAt: NOW,
        sessionState: 'alive',
        capturedDuringActiveTurn: false,
        source: 'model',
        captureMode: 'lean',
        sources: ['git'],
        facts,
        understanding: '',
        pendingItems: [],
        tomorrowPlan: [],
        generationError: null,
      });
      const gitReader = new FakeGitReader(
        new Map([[session.cwd, { hasGit: true, facts: unchangedGitFacts, rejectedWorktrees: [] }]]),
      );
      const deps = buildDeps({ storage, gitReader });
      const outcome = await captureSession({
        deps,
        session,
        config: DEFAULT_TEST_CONFIG,
        now: NOW,
        day: DAY,
      });
      expect(outcome).toEqual({ kind: 'ineligible', reasons: ['duplicateToday'] });
    },
  );

  it('builds a handoff with source "model" and captureMode "lean" by default', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const deps = buildDeps({
      leanGenerator: succeedingGenerator({
        understanding: 'worked on X',
        pendingItems: ['finish X'],
        tomorrowPlan: ['start Y'],
      }),
    });
    const outcome = await captureSession({
      deps,
      session,
      config: DEFAULT_TEST_CONFIG,
      now: NOW,
      day: DAY,
    });
    expect(outcome.kind).toBe('captured');
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.handoff.source).toBe('model');
    expect(outcome.handoff.captureMode).toBe('lean');
    expect(outcome.handoff.understanding).toBe('worked on X');
  });

  it('uses the deep generator when deepCapture is true and the session has a transcript', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { [session.cwd]: { canTerminate: false, deepCapture: true } },
    };
    const deps = buildDeps({
      deepGenerator: succeedingGenerator({
        understanding: 'from resume',
        pendingItems: [],
        tomorrowPlan: [],
      }),
      leanGenerator: failingGenerator('lean should not have been called'),
    });
    const outcome = await captureSession({ deps, session, config, now: NOW, day: DAY });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.handoff.captureMode).toBe('deep');
    expect(outcome.handoff.understanding).toBe('from resume');
  });

  it(
    'a session with no transcript uses lean even with deepCapture: true, and a successful ' +
      'result is still source: "model" (D-013/D-018, Q-021 item 1) — sources[] is what says ' +
      'the transcript was missing, not source',
    async () => {
      const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
      const config = {
        ...DEFAULT_TEST_CONFIG,
        projectPolicy: { [session.cwd]: { canTerminate: false, deepCapture: true } },
      };
      const deps = buildDeps({
        deepGenerator: failingGenerator('deep should not have been called'),
        leanGenerator: succeedingGenerator({
          understanding: 'from lean',
          pendingItems: [],
          tomorrowPlan: [],
        }),
      });
      const outcome = await captureSession({ deps, session, config, now: NOW, day: DAY });
      if (outcome.kind !== 'captured') throw new Error('expected captured');
      expect(outcome.handoff.captureMode).toBe('lean');
      expect(outcome.handoff.source).toBe('model');
      expect(outcome.handoff.understanding).toBe('from lean');
      expect(outcome.handoff.sources).not.toContain('transcript');
    },
  );

  it('generation failure produces a "deterministic" handoff with facts, not an exception (D-003)', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const deps = buildDeps({ leanGenerator: failingGenerator('network error') });
    const outcome = await captureSession({
      deps,
      session,
      config: DEFAULT_TEST_CONFIG,
      now: NOW,
      day: DAY,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured, not an exception');
    expect(outcome.handoff.source).toBe('deterministic');
    expect(outcome.handoff.generationError).toBe('network error');
    expect(outcome.handoff.understanding).toBe('');
  });

  it('marks capturedDuringActiveTurn when the transcript was written in the last 60s', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const deps = buildDeps({
      transcriptReader: new FakeTranscriptReader(
        new Map([
          [
            session.sessionId,
            {
              facts: {
                lastActivity: new Date(NOW.getTime() - 5_000),
                lastPrompts: [],
                assistantMessages: [],
                touchedFiles: [],
              },
              rejected: [],
              unknownEntryTypeCount: 0,
            },
          ],
        ]),
      ),
    });
    const outcome = await captureSession({
      deps,
      session,
      config: DEFAULT_TEST_CONFIG,
      now: NOW,
      day: DAY,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.handoff.capturedDuringActiveTurn).toBe(true);
  });

  it('does not mark capturedDuringActiveTurn when the last write is old, and still captures it', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const deps = buildDeps({
      transcriptReader: new FakeTranscriptReader(
        new Map([
          [
            session.sessionId,
            {
              facts: {
                lastActivity: new Date(NOW.getTime() - 600_000),
                lastPrompts: [],
                assistantMessages: [],
                touchedFiles: [],
              },
              rejected: [],
              unknownEntryTypeCount: 0,
            },
          ],
        ]),
      ),
    });
    const outcome = await captureSession({
      deps,
      session,
      config: DEFAULT_TEST_CONFIG,
      now: NOW,
      day: DAY,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.handoff.capturedDuringActiveTurn).toBe(false);
  });

  it('does not claim capturedDuringActiveTurn from absence of evidence (D-025)', async () => {
    const session = createSessionWithoutPid({ hasTranscript: false, lastActivity: NOW });
    const deps = buildDeps({
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
    const outcome = await captureSession({
      deps,
      session,
      config: DEFAULT_TEST_CONFIG,
      now: NOW,
      day: DAY,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.handoff.capturedDuringActiveTurn).toBe(false);
  });
});

describe('captureSession — D-002 ordering and Q-007', () => {
  function eligibleSession() {
    return createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
  }

  function canTerminateConfig(cwd: string) {
    return {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { [cwd]: { canTerminate: true, deepCapture: false } },
    };
  }

  it('terminates only after the handoff is verified on disk', async () => {
    const session = eligibleSession();
    const calls: string[] = [];
    const storage = new OrderRecordingStorage(DEFAULT_TEST_CONFIG, calls);
    const processControl = new FakeProcessControl(() => {
      calls.push('terminate');
      return true;
    });
    const deps = buildDeps({ storage, processControl });
    const outcome = await captureSession({
      deps,
      session,
      config: canTerminateConfig(session.cwd),
      now: NOW,
      day: DAY,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.terminated).toBe(true);
    // The first 'read' is D-026's anti-duplication check (evaluateFullEligibility, looking for a
    // previous capture today) — it necessarily runs before the handoff exists to save. The
    // save→read→terminate tail is the one D-002 actually requires: verified on disk before the
    // process is ever touched.
    expect(calls).toEqual(['read', 'save', 'read', 'terminate']);
    expect(calls.slice(1)).toEqual(['save', 'read', 'terminate']);
  });

  it('a save failure aborts termination — terminateGracefully is never called (D-002)', async () => {
    const session = eligibleSession();
    let terminateCalled = false;
    const processControl = new FakeProcessControl(() => {
      terminateCalled = true;
      return true;
    });
    const storage = new FailingSaveStorage(DEFAULT_TEST_CONFIG);
    const deps = buildDeps({ storage, processControl });
    await expect(
      captureSession({
        deps,
        session,
        config: canTerminateConfig(session.cwd),
        now: NOW,
        day: DAY,
      }),
    ).rejects.toThrow();
    expect(terminateCalled).toBe(false);
  });

  it(
    'a save that "succeeds" but cannot be read back also aborts termination — verification, not ' +
      'just the write, gates D-002',
    async () => {
      const session = eligibleSession();
      let terminateCalled = false;
      const processControl = new FakeProcessControl(() => {
        terminateCalled = true;
        return true;
      });
      const storage = new UnverifiableSaveStorage(DEFAULT_TEST_CONFIG);
      const deps = buildDeps({ storage, processControl });
      await expect(
        captureSession({
          deps,
          session,
          config: canTerminateConfig(session.cwd),
          now: NOW,
          day: DAY,
        }),
      ).rejects.toThrow(/could not be read back/);
      expect(terminateCalled).toBe(false);
    },
  );

  it('canTerminate: false never attempts termination', async () => {
    const session = eligibleSession();
    let terminateCalled = false;
    const processControl = new FakeProcessControl(() => {
      terminateCalled = true;
      return true;
    });
    const deps = buildDeps({ processControl });
    const outcome = await captureSession({
      deps,
      session,
      config: DEFAULT_TEST_CONFIG,
      now: NOW,
      day: DAY,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.terminated).toBe(false);
    expect(outcome.terminationNotice).toBeNull();
    expect(terminateCalled).toBe(false);
  });

  it('a session with no PID is never a termination candidate even with canTerminate: true', async () => {
    const session = createSessionWithoutPid({ hasTranscript: true, lastActivity: NOW });
    let terminateCalled = false;
    const processControl = new FakeProcessControl(() => {
      terminateCalled = true;
      return true;
    });
    const deps = buildDeps({ processControl });
    const outcome = await captureSession({
      deps,
      session,
      config: canTerminateConfig(session.cwd),
      now: NOW,
      day: DAY,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.terminated).toBe(false);
    expect(terminateCalled).toBe(false);
  });

  it(
    'Q-007: terminateGracefully returning false with the process still alive is not an error, ' +
      'is not thrown, and produces a named TerminationNotice',
    async () => {
      const session = eligibleSession();
      const processControl = new FakeProcessControl(() => false);
      const deps = buildDeps({ processControl });
      const outcome = await captureSession({
        deps,
        session,
        config: canTerminateConfig(session.cwd),
        now: NOW,
        day: DAY,
      });
      if (outcome.kind !== 'captured') throw new Error('expected captured, not thrown');
      expect(outcome.terminated).toBe(false);
      expect(outcome.terminationNotice).not.toBeNull();
      expect(outcome.terminationNotice?.sessionId).toBe(session.sessionId);
      expect(outcome.terminationNotice?.reason).toMatch(/still alive/);
    },
  );
});

describe('captureSession — dry-run (S2-T5)', () => {
  it('never calls saveHandoff/readHandoff/terminateGracefully when dryRun is true', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    let saveCalled = false;
    let terminateCalled = false;
    class SpyStorage extends FakeStorage {
      override saveHandoff(day: Day, handoff: Handoff): Promise<void> {
        saveCalled = true;
        return super.saveHandoff(day, handoff);
      }
    }
    const storage = new SpyStorage(DEFAULT_TEST_CONFIG);
    const processControl = new FakeProcessControl(() => {
      terminateCalled = true;
      return true;
    });
    const config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { [session.cwd]: { canTerminate: true, deepCapture: false } },
    };
    const deps = buildDeps({ storage, processControl });
    const outcome = await captureSession({
      deps,
      session,
      config,
      now: NOW,
      day: DAY,
      dryRun: true,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.terminated).toBe(false);
    expect(outcome.terminationNotice).toBeNull();
    expect(saveCalled).toBe(false);
    expect(terminateCalled).toBe(false);
    expect(storage.savedHandoffs.size).toBe(0);
  });

  it('still calls the real lean generator during a dry run — lean has no disk footprint (D-017)', async () => {
    const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
    const deps = buildDeps({
      leanGenerator: succeedingGenerator({
        understanding: 'dry-run preview',
        pendingItems: [],
        tomorrowPlan: [],
      }),
    });
    const outcome = await captureSession({
      deps,
      session,
      config: DEFAULT_TEST_CONFIG,
      now: NOW,
      day: DAY,
      dryRun: true,
    });
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.handoff.source).toBe('model');
    expect(outcome.handoff.understanding).toBe('dry-run preview');
  });

  it(
    'never calls the deep generator during a dry run — a real deep call would write a real fork ' +
      '(D-012) that --dry-run must never create',
    async () => {
      const session = createSessionWithPid({ hasTranscript: true, lastActivity: NOW });
      const config = {
        ...DEFAULT_TEST_CONFIG,
        projectPolicy: { [session.cwd]: { canTerminate: false, deepCapture: true } },
      };
      const deps = buildDeps({
        deepGenerator: failingGenerator('deep must never be called during --dry-run'),
      });
      const outcome = await captureSession({
        deps,
        session,
        config,
        now: NOW,
        day: DAY,
        dryRun: true,
      });
      if (outcome.kind !== 'captured') throw new Error('expected captured');
      expect(outcome.handoff.captureMode).toBe('deep');
      expect(outcome.handoff.source).toBe('deterministic');
      expect(outcome.handoff.generationError).toMatch(/dry-run/);
    },
  );

  it('D-026 anti-duplication still runs for real during a dry run (a real read, not a write)', async () => {
    const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
    const unchangedGitFacts = {
      branch: 'main',
      dirty: false,
      modifiedFiles: [],
      commitsToday: [],
      worktrees: [],
    };
    const facts = {
      lastActivity: null,
      lastPrompts: [],
      assistantMessages: [],
      touchedFiles: [],
      git: unchangedGitFacts,
    };
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff(DAY, {
      sessionId: session.sessionId,
      cwd: session.cwd,
      name: session.name,
      capturedAt: NOW,
      sessionState: 'alive',
      capturedDuringActiveTurn: false,
      source: 'model',
      captureMode: 'lean',
      sources: ['git'],
      facts,
      understanding: '',
      pendingItems: [],
      tomorrowPlan: [],
      generationError: null,
    });
    const gitReader = new FakeGitReader(
      new Map([[session.cwd, { hasGit: true, facts: unchangedGitFacts, rejectedWorktrees: [] }]]),
    );
    const deps = buildDeps({ storage, gitReader });
    const outcome = await captureSession({
      deps,
      session,
      config: DEFAULT_TEST_CONFIG,
      now: NOW,
      day: DAY,
      dryRun: true,
    });
    expect(outcome).toEqual({ kind: 'ineligible', reasons: ['duplicateToday'] });
  });
});
