import { describe, expect, it } from 'vitest';
import { formatResumeNotice } from '../../../src/core/resume-notice.js';
import type { ResumeOutcome } from '../../../src/core/types.js';

describe('formatResumeNotice — D-004 "avisar o usuário que houve fallback"', () => {
  it('returns null when the resume attached cleanly — nothing to warn about', () => {
    const outcome: ResumeOutcome = { sessionId: 'abc', cwd: '/work/project', fellBack: false };
    expect(formatResumeNotice(outcome)).toBeNull();
  });

  it('names the session and the exit code for a resumeFailed fallback, without inventing a cause', () => {
    const outcome: ResumeOutcome = {
      sessionId: 'abc-123',
      cwd: '/work/project',
      fellBack: { kind: 'resumeFailed', exitCode: 1 },
    };
    const notice = formatResumeNotice(outcome);
    expect(notice).not.toBeNull();
    expect(notice).toContain('abc-123');
    expect(notice).toContain('/work/project');
    expect(notice).toContain('code 1');
    // D-025: never claims a specific cause (expired session, moved project) the exit code alone
    // can't establish.
    expect(notice).not.toMatch(/expired/i);
    expect(notice).not.toMatch(/moved/i);
  });

  it('names the two numbers for a promptTooLarge fallback', () => {
    const outcome: ResumeOutcome = {
      sessionId: 'abc-123',
      cwd: '/work/project',
      fellBack: { kind: 'promptTooLarge', promptLength: 9000, limitChars: 4096 },
    };
    const notice = formatResumeNotice(outcome);
    expect(notice).toContain('9000');
    expect(notice).toContain('4096');
  });

  it('always says a fresh session was opened, distinct from a real resume', () => {
    const outcome: ResumeOutcome = {
      sessionId: 'abc-123',
      cwd: '/work/project',
      fellBack: { kind: 'resumeFailed', exitCode: 1 },
    };
    const notice = formatResumeNotice(outcome) ?? '';
    expect(notice).toMatch(/new session/i);
    expect(notice).toMatch(/fresh conversation/i);
  });
});
