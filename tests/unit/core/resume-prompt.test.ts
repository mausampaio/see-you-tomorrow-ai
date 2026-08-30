import { describe, expect, it } from 'vitest';
import { buildResumePrompt, buildResumePrompts } from '../../../src/core/resume-prompt.js';
import type { Briefing } from '../../../src/core/ports.js';
import { createHandoff } from './_fixtures.js';

describe('buildResumePrompt — source: "model" (D-003/D-004: the plan is the prompt)', () => {
  it('includes the header naming the session, cwd and captured state', () => {
    const prompt = buildResumePrompt(
      createHandoff({ name: 'projeto-01', cwd: 'c:\\code\\projeto', sessionState: 'ended' }),
    );
    expect(prompt).toContain('projeto-01');
    expect(prompt).toContain('c:\\code\\projeto');
    expect(prompt).toContain('state: ended');
  });

  it('includes the understanding, pending items and plan the model produced', () => {
    const prompt = buildResumePrompt(
      createHandoff({
        understanding: 'Refactored the parser to handle nested arrays.',
        pendingItems: ['add a test for empty input'],
        tomorrowPlan: ['wire the parser into the CLI'],
      }),
    );
    expect(prompt).toContain('Refactored the parser to handle nested arrays.');
    expect(prompt).toContain('add a test for empty input');
    expect(prompt).toContain('wire the parser into the CLI');
  });

  it('says plainly when nothing was pending, instead of an empty list (D-025)', () => {
    const prompt = buildResumePrompt(createHandoff({ pendingItems: [], tomorrowPlan: [] }));
    expect(prompt).toContain(
      'Nothing was left pending, as far as the previous capture could tell.',
    );
    expect(prompt).toContain('No plan was recorded for today.');
  });

  it('never mentions a failed capture for a successful model handoff', () => {
    const prompt = buildResumePrompt(createHandoff({ source: 'model' }));
    expect(prompt).not.toContain('could not produce a summary');
  });

  it('falls back to a placeholder when the model ran but wrote no understanding text', () => {
    const prompt = buildResumePrompt(createHandoff({ understanding: '   ' }));
    expect(prompt).toContain('_Nothing recorded._');
  });
});

describe('buildResumePrompt — capturedDuringActiveTurn (D-025)', () => {
  it('adds an explicit staleness caveat when captured mid-turn', () => {
    const prompt = buildResumePrompt(createHandoff({ capturedDuringActiveTurn: true }));
    expect(prompt).toContain('captured while you were still mid-turn');
  });

  it('adds no caveat at all when not captured mid-turn', () => {
    const prompt = buildResumePrompt(createHandoff({ capturedDuringActiveTurn: false }));
    expect(prompt).not.toContain('mid-turn');
  });
});

describe('buildResumePrompt — source: "deterministic" (honest, not empty)', () => {
  it('states plainly that the model call failed, naming the error', () => {
    const prompt = buildResumePrompt(
      createHandoff({
        source: 'deterministic',
        generationError: 'claude exited with code 1: quota exceeded',
        understanding: '',
        pendingItems: [],
        tomorrowPlan: [],
      }),
    );
    expect(prompt).toContain('could not produce a summary');
    expect(prompt).toContain('quota exceeded');
  });

  it('never fabricates understanding, pending items or a plan for a deterministic handoff', () => {
    const prompt = buildResumePrompt(
      createHandoff({ source: 'deterministic', generationError: 'timeout', understanding: '' }),
    );
    expect(prompt).not.toContain('What you were doing');
    expect(prompt).not.toContain('Pending items:');
    expect(prompt).not.toContain('Plan for today:');
  });

  it('hands over the raw facts that were actually recorded', () => {
    const prompt = buildResumePrompt(
      createHandoff({
        source: 'deterministic',
        generationError: 'timeout',
        facts: {
          lastActivity: new Date('2026-08-16T20:45:00.000Z'),
          lastPrompts: ['fix the flaky test'],
          touchedFiles: ['src/parser.ts'],
          git: {
            branch: 'main',
            dirty: true,
            modifiedFiles: ['src/parser.ts'],
            commitsToday: [],
            worktrees: [],
          },
        },
      }),
    );
    expect(prompt).toContain('fix the flaky test');
    expect(prompt).toContain('src/parser.ts');
    expect(prompt).toContain('Branch: main');
  });

  it('never claims completion from the absence of analysis (D-025)', () => {
    const prompt = buildResumePrompt(
      createHandoff({ source: 'deterministic', generationError: 'timeout' }),
    );
    expect(prompt).toContain('absence of analysis is not evidence of completion');
  });

  it('falls back to a generic message when no error string was recorded', () => {
    const prompt = buildResumePrompt(
      createHandoff({ source: 'deterministic', generationError: null }),
    );
    expect(prompt).toContain('no error message was recorded');
  });

  it('says "unknown" for last activity rather than inventing a timestamp (D-025)', () => {
    const prompt = buildResumePrompt(
      createHandoff({
        source: 'deterministic',
        generationError: 'timeout',
        facts: { lastActivity: null, lastPrompts: [], touchedFiles: [], git: null },
      }),
    );
    expect(prompt).toContain('Last activity: unknown');
  });
});

describe('buildResumePrompt — source: "noTranscript"', () => {
  it('names the absence of a transcript as the reason, not a model failure', () => {
    const prompt = buildResumePrompt(
      createHandoff({
        source: 'noTranscript',
        understanding: '',
        pendingItems: [],
        tomorrowPlan: [],
      }),
    );
    expect(prompt).toContain('there was no transcript to analyze');
  });
});

describe('buildResumePrompts', () => {
  it('builds one prompt per handoff, carrying sessionId/cwd alongside the text', () => {
    const a = createHandoff({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\a',
      name: 'a',
    });
    const b = createHandoff({
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: 'c:\\code\\b',
      name: 'b',
    });
    const briefing: Briefing = { day: '2026-08-16', handoffs: [a, b], rejected: [] };
    const prompts = buildResumePrompts(briefing);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toEqual({
      sessionId: a.sessionId,
      cwd: a.cwd,
      prompt: buildResumePrompt(a),
    });
    expect(prompts[1]).toEqual({
      sessionId: b.sessionId,
      cwd: b.cwd,
      prompt: buildResumePrompt(b),
    });
  });

  it('returns an empty list for a briefing with no handoffs', () => {
    const briefing: Briefing = { day: '2026-08-16', handoffs: [], rejected: [] };
    expect(buildResumePrompts(briefing)).toEqual([]);
  });
});
