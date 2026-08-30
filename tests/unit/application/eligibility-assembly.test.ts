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
  touchedFiles: [],
  git: null,
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
    'a previous capture with NO transcript, but git changed since, is NOT a duplicate ' +
      '(D-026 — the autonomous execution agent case)',
    async () => {
      const session = createSessionWithPid({ hasTranscript: false, lastActivity: NOW });
      const previousFacts: HandoffFacts = {
        lastActivity: null,
        lastPrompts: [],
        touchedFiles: [],
        git: { branch: 'main', dirty: false, modifiedFiles: [], commitsToday: [], worktrees: [] },
      };
      const currentFacts: HandoffFacts = {
        lastActivity: null,
        lastPrompts: [],
        touchedFiles: [],
        git: {
          branch: 'main',
          dirty: true,
          modifiedFiles: ['src/a.ts'],
          commitsToday: [{ sha: '1b7fd99', title: 'work' }],
          worktrees: [],
        },
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
