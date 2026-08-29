import { describe, expect, it } from 'vitest';
import {
  buildLeanPrompt,
  DEEP_GENERATION_PROMPT,
} from '../../../../src/adapters/generation/prompt.js';
import type { SessionFacts, SessionWithoutPid } from '../../../../src/core/types.js';

function session(overrides: Partial<SessionWithoutPid> = {}): SessionWithoutPid {
  return {
    hasPid: false,
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: 'c:\\code\\projeto-01',
    name: 'projeto-01',
    hasTranscript: true,
    lastTranscriptWrite: new Date('2026-08-16T10:00:00.000Z'),
    lastActivity: new Date('2026-08-16T10:00:00.000Z'),
    ...overrides,
  };
}

function facts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return {
    lastActivity: new Date('2026-08-16T10:00:00.000Z'),
    lastPrompts: [],
    touchedFiles: [],
    ...overrides,
  };
}

describe('buildLeanPrompt', () => {
  it('always includes the project name and cwd', () => {
    const prompt = buildLeanPrompt(session(), facts());
    expect(prompt).toContain('Project: projeto-01');
    expect(prompt).toContain('Working directory: c:\\code\\projeto-01');
  });

  it('includes the last-activity instant as ISO when facts has one', () => {
    const prompt = buildLeanPrompt(
      session(),
      facts({ lastActivity: new Date('2026-08-16T10:00:00.000Z') }),
    );
    expect(prompt).toContain('Last known activity: 2026-08-16T10:00:00.000Z');
  });

  it('omits the last-activity line when facts.lastActivity is null (D-025: no data, no line)', () => {
    const prompt = buildLeanPrompt(session(), facts({ lastActivity: null }));
    expect(prompt).not.toContain('Last known activity');
  });

  it('lists prompts and touched files as bullets, in order', () => {
    const prompt = buildLeanPrompt(
      session(),
      facts({ lastPrompts: ['first', 'second'], touchedFiles: ['src/a.ts', 'src/b.ts'] }),
    );
    expect(prompt).toContain('Recent user prompts (oldest first):\n- first\n- second');
    expect(prompt).toContain('Files touched:\n- src/a.ts\n- src/b.ts');
  });

  it('omits a section entirely when its list is empty, rather than printing an empty header', () => {
    const prompt = buildLeanPrompt(session(), facts({ lastPrompts: [], touchedFiles: ['x'] }));
    expect(prompt).not.toContain('Recent user prompts');
    expect(prompt).toContain('Files touched');
  });

  it('says plainly that no transcript evidence was found when both lists are empty (D-025)', () => {
    const prompt = buildLeanPrompt(session(), facts({ lastPrompts: [], touchedFiles: [] }));
    expect(prompt).toContain('No transcript evidence was available for this session.');
  });

  it('preserves a multi-line prompt entry verbatim, embedded newline included (D-015 concern)', () => {
    const multiline = 'line one\nline two with "quotes" and % and café';
    const prompt = buildLeanPrompt(session(), facts({ lastPrompts: [multiline] }));
    expect(prompt).toContain(`- ${multiline}`);
  });
});

describe('DEEP_GENERATION_PROMPT', () => {
  it('is a short fixed instruction, not derived from any session data', () => {
    expect(DEEP_GENERATION_PROMPT.length).toBeGreaterThan(0);
    expect(DEEP_GENERATION_PROMPT).not.toContain('undefined');
  });
});
