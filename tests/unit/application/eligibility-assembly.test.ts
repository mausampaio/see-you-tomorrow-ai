import { describe, expect, it } from 'vitest';
import {
  evaluateCheapEligibility,
  evaluateFullEligibility,
  projectPolicyFor,
} from '../../../src/application/eligibility-assembly.js';
import { createSessionWithPid } from '../core/_fixtures.js';
import type { HandoffFacts } from '../../../src/core/types.js';
import { DEFAULT_TEST_CONFIG, FakeStorage } from './_fakes.js';

const NOW = new Date('2026-08-16T21:00:00.000Z');

const NO_EVIDENCE_FACTS: HandoffFacts = {
  lastActivity: null,
  lastPrompts: [],
  assistantMessages: [],
  touchedFiles: [],
  git: [],
  filesOutsideRepository: 0,
  reposNotVisited: 0,
};

describe('projectPolicyFor', () => {
  it('defaults to canTerminate/deepCapture false for a cwd the config never mentions', () => {
    expect(projectPolicyFor(DEFAULT_TEST_CONFIG, 'c:\\code\\unknown')).toEqual({
      canTerminate: false,
      deepCapture: false,
    });
  });

  it('returns the configured policy for a known cwd', () => {
    const config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
    };
    expect(projectPolicyFor(config, 'c:\\code\\projeto')).toEqual({
      canTerminate: true,
      deepCapture: false,
    });
  });

  // S4-T12 (docs/QUESTOES.md Q-056 item 3): before this, `projectPolicyFor` compared the raw
  // `projectPolicy` key against a raw session `cwd`, so a session's `canTerminate`/`deepCapture`
  // silently never applied unless the two spellings matched EXACTLY — the same bug S3-T5 already
  // fixed for `ignore`. Separator/trailing-slash cases are platform-independent (`core/
  // cwd-normalization.ts` only folds case on `win32`), so these run on every CI host.
  describe('policy matching normalizes cwd before comparing', () => {
    it('a session cwd spelled with forward slashes still matches a backslash-spelled policy key', () => {
      const config = {
        ...DEFAULT_TEST_CONFIG,
        projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
      };
      expect(projectPolicyFor(config, 'c:/code/projeto')).toEqual({
        canTerminate: true,
        deepCapture: false,
      });
    });

    it('a trailing separator on either side does not defeat the match', () => {
      const config = {
        ...DEFAULT_TEST_CONFIG,
        projectPolicy: { 'c:\\code\\projeto\\': { canTerminate: true, deepCapture: true } },
      };
      expect(projectPolicyFor(config, 'c:\\code\\projeto')).toEqual({
        canTerminate: true,
        deepCapture: true,
      });
    });

    it('a genuinely different cwd never matches just because it shares a prefix', () => {
      const config = {
        ...DEFAULT_TEST_CONFIG,
        projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
      };
      expect(projectPolicyFor(config, 'c:\\code\\projeto-2')).toEqual({
        canTerminate: false,
        deepCapture: false,
      });
    });

    // Case-folding is platform-gated (win32 only) — run only on a real win32 CI host so this never
    // depends on running on Windows TO PASS (S3-T5's own lesson), it just also never runs elsewhere
    // pretending to prove something it can't on that host.
    it.runIf(process.platform === 'win32')(
      'on win32, a policy key written with different case still matches (S4-T12 cuidado (a) example)',
      () => {
        const config = {
          ...DEFAULT_TEST_CONFIG,
          projectPolicy: { 'C:\\code\\X\\': { canTerminate: true, deepCapture: false } },
        };
        expect(projectPolicyFor(config, 'c:/code/x')).toEqual({
          canTerminate: true,
          deepCapture: false,
        });
      },
    );
  });

  // D-002 stays opt-in: this task makes a CONFIGURED policy apply reliably, it must never make
  // termination apply somewhere nobody configured it.
  it('a cwd absent from projectPolicy still defaults to false, even under normalization', () => {
    const config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: true } },
    };
    expect(projectPolicyFor(config, 'c:\\code\\outro-projeto')).toEqual({
      canTerminate: false,
      deepCapture: false,
    });
  });
});

describe('evaluateCheapEligibility (no I/O)', () => {
  it('a session with no lastActivity at all is ineligible: noEvidence', () => {
    const session = createSessionWithPid({ lastActivity: null });
    const result = evaluateCheapEligibility(session, NOW, DEFAULT_TEST_CONFIG);
    expect(result).toEqual({ eligible: false, reasons: ['noEvidence'] });
  });

  it('a session on the ignore list is ineligible: ignoredCwd', () => {
    const session = createSessionWithPid({ cwd: 'c:\\code\\rascunhos', lastActivity: NOW });
    const config = { ...DEFAULT_TEST_CONFIG, ignore: ['c:\\code\\rascunhos'] };
    const result = evaluateCheapEligibility(session, NOW, config);
    expect(result).toEqual({ eligible: false, reasons: ['ignoredCwd'] });
  });

  it('a session with recent activity and no other issue is eligible at the cheap stage', () => {
    const session = createSessionWithPid({ lastActivity: NOW });
    const result = evaluateCheapEligibility(session, NOW, DEFAULT_TEST_CONFIG);
    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  it('never reports ownSeeyaFork — forks are already excluded by discovery (D-012)', () => {
    // knownForks is always empty in this function; there is no way for the caller to make it
    // report `ownSeeyaFork` even by fabricating a session with a "known" sessionId.
    const session = createSessionWithPid({ lastActivity: NOW });
    const result = evaluateCheapEligibility(session, NOW, DEFAULT_TEST_CONFIG);
    expect(result.reasons).not.toContain('ownSeeyaFork');
  });

  describe('ignore-list matching normalizes cwd before comparing (S3-T5)', () => {
    it('a session cwd spelled with forward slashes still matches a backslash-spelled ignore entry', () => {
      const session = createSessionWithPid({ cwd: 'c:/code/rascunhos', lastActivity: NOW });
      const config = { ...DEFAULT_TEST_CONFIG, ignore: ['c:\\code\\rascunhos'] };
      const result = evaluateCheapEligibility(session, NOW, config);
      expect(result).toEqual({ eligible: false, reasons: ['ignoredCwd'] });
    });

    it('a trailing separator on either side does not defeat the ignore match', () => {
      const session = createSessionWithPid({ cwd: 'c:\\code\\rascunhos\\', lastActivity: NOW });
      const config = { ...DEFAULT_TEST_CONFIG, ignore: ['c:\\code\\rascunhos'] };
      const result = evaluateCheapEligibility(session, NOW, config);
      expect(result.eligible).toBe(false);
    });

    it('a genuinely different cwd is never ignored just because it shares a prefix', () => {
      const session = createSessionWithPid({ cwd: 'c:\\code\\rascunhos-2', lastActivity: NOW });
      const config = { ...DEFAULT_TEST_CONFIG, ignore: ['c:\\code\\rascunhos'] };
      const result = evaluateCheapEligibility(session, NOW, config);
      expect(result.eligible).toBe(true);
    });
  });
});

describe('evaluateFullEligibility (D-026 anti-duplication)', () => {
  it('no previous capture today — eligible', async () => {
    const session = createSessionWithPid({ lastActivity: NOW });
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const result = await evaluateFullEligibility(
      session,
      NOW,
      DEFAULT_TEST_CONFIG,
      storage,
      '2026-08-16',
      NO_EVIDENCE_FACTS,
    );
    expect(result.eligible).toBe(true);
  });

  it('a previous capture today with identical facts is ineligible: duplicateToday', async () => {
    const session = createSessionWithPid({ lastActivity: NOW });
    const facts: HandoffFacts = { ...NO_EVIDENCE_FACTS, lastActivity: NOW };
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
      sources: ['transcript'],
      facts,
      understanding: '',
      pendingItems: [],
      tomorrowPlan: [],
      generationError: null,
    });
    const result = await evaluateFullEligibility(
      session,
      NOW,
      DEFAULT_TEST_CONFIG,
      storage,
      '2026-08-16',
      facts,
    );
    expect(result).toEqual({ eligible: false, reasons: ['duplicateToday'] });
  });

  it(
    'a previous DETERMINISTIC capture today with identical facts is eligible again — a failed ' +
      'generation attempt is not "already captured" (S4-T00e)',
    async () => {
      const session = createSessionWithPid({ lastActivity: NOW });
      const facts: HandoffFacts = { ...NO_EVIDENCE_FACTS, lastActivity: NOW };
      const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
      await storage.saveHandoff('2026-08-16', {
        sessionId: session.sessionId,
        cwd: session.cwd,
        name: session.name,
        capturedAt: NOW,
        sessionState: 'alive',
        capturedDuringActiveTurn: false,
        source: 'deterministic',
        captureMode: 'lean',
        sources: ['transcript'],
        facts,
        understanding: '',
        pendingItems: [],
        tomorrowPlan: [],
        generationError: 'budget exceeded',
      });
      const result = await evaluateFullEligibility(
        session,
        NOW,
        DEFAULT_TEST_CONFIG,
        storage,
        '2026-08-16',
        facts,
      );
      expect(result).toStrictEqual({ eligible: true, reasons: [] });
    },
  );

  it(
    'a previous capture with NO transcript, but git changed since, is NOT a duplicate ' +
      '(D-026 — the autonomous execution agent case)',
    async () => {
      const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
      const previousFacts: HandoffFacts = {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: [
          {
            root: session.cwd,
            branch: 'main',
            dirty: false,
            modifiedFiles: [],
            commitsToday: [],
            worktrees: [],
          },
        ],
        filesOutsideRepository: 0,
        reposNotVisited: 0,
      };
      const currentFacts: HandoffFacts = {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: [
          {
            root: session.cwd,
            branch: 'main',
            dirty: true,
            modifiedFiles: ['src/a.ts'],
            commitsToday: [{ sha: '1b7fd99', title: 'work' }],
            worktrees: [],
          },
        ],
        filesOutsideRepository: 0,
        reposNotVisited: 0,
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
        facts: previousFacts,
        understanding: '',
        pendingItems: [],
        tomorrowPlan: [],
        generationError: null,
      });
      const result = await evaluateFullEligibility(
        session,
        NOW,
        DEFAULT_TEST_CONFIG,
        storage,
        '2026-08-16',
        currentFacts,
      );
      expect(result.eligible).toBe(true);
    },
  );
});
