import { describe, expect, it } from 'vitest';
import {
  formatNoPendingBriefing,
  formatNoSessionMatch,
  formatNoTtyInstructions,
  formatResumeProgress,
  formatStartDaySummary,
  renderPickerQuestion,
} from '../../../src/cli/format-start-day.js';
import type { ResumeSessionsResult } from '../../../src/application/start-day.js';
import { createHandoff } from '../core/_fixtures.js';

describe('formatNoPendingBriefing', () => {
  it('names how many days were scanned', () => {
    expect(formatNoPendingBriefing(31)).toContain('31');
  });
});

describe('formatNoTtyInstructions', () => {
  it('mentions both flags a caller without a TTY can use instead', () => {
    const text = formatNoTtyInstructions();
    expect(text).toContain('--all');
    expect(text).toContain('--session');
  });
});

describe('formatNoSessionMatch', () => {
  it('names the value that did not match', () => {
    expect(formatNoSessionMatch('nothing-like-this')).toContain('"nothing-like-this"');
  });
});

describe('renderPickerQuestion', () => {
  it('numbers each candidate starting at 1, with name and cwd', () => {
    const alpha = createHandoff({ name: 'alpha', cwd: 'c:\\code\\alpha' });
    const beta = createHandoff({ sessionId: '2', name: 'beta', cwd: 'c:\\code\\beta' });
    const question = renderPickerQuestion([alpha, beta]);
    expect(question).toContain('1) alpha (c:\\code\\alpha)');
    expect(question).toContain('2) beta (c:\\code\\beta)');
  });
});

describe('formatResumeProgress', () => {
  it('names the index, total, and session', () => {
    const handoff = createHandoff({ name: 'alpha', cwd: 'c:\\code\\alpha' });
    expect(formatResumeProgress({ index: 2, total: 3, handoff })).toBe(
      'Resuming 2 of 3: alpha (c:\\code\\alpha)...',
    );
  });
});

describe('formatStartDaySummary', () => {
  it('lists every resumed session, with a clean resume showing no extra notice', () => {
    const result: ResumeSessionsResult = {
      resumed: [{ sessionId: 'alpha-id', cwd: 'c:\\code\\alpha', fellBack: false }],
      remaining: [],
      stoppedEarly: false,
    };
    const text = formatStartDaySummary(result);
    expect(text).toContain('Resumed:');
    expect(text).toContain('alpha-id');
    expect(text).not.toContain('Not resumed');
  });

  it('surfaces the fallback notice for a resumed-via-fallback session', () => {
    const result: ResumeSessionsResult = {
      resumed: [
        {
          sessionId: 'alpha-id',
          cwd: 'c:\\code\\alpha',
          fellBack: { kind: 'resumeFailed', exitCode: 1 },
        },
      ],
      remaining: [],
      stoppedEarly: false,
    };
    const text = formatStartDaySummary(result);
    expect(text).toContain('could not be resumed');
  });

  it('names what stopped the loop AND lists every session that never got a chance', () => {
    const failed = createHandoff({ name: 'beta', cwd: 'c:\\code\\beta' });
    const neverTried = createHandoff({
      sessionId: 'gamma-id',
      name: 'gamma',
      cwd: 'c:\\code\\gamma',
    });
    const result: ResumeSessionsResult = {
      resumed: [{ sessionId: 'alpha-id', cwd: 'c:\\code\\alpha', fellBack: false }],
      remaining: [failed, neverTried],
      stoppedEarly: { handoff: failed, error: new Error('claude is not on PATH') },
    };
    const text = formatStartDaySummary(result);
    expect(text).toContain('Resumed:');
    expect(text).toContain('stopped after "beta"');
    expect(text).toContain('claude is not on PATH');
    expect(text).toContain('- beta (c:\\code\\beta)');
    expect(text).toContain('- gamma (c:\\code\\gamma)');
  });

  it('nothing resumed and nothing remaining is an empty summary', () => {
    const result: ResumeSessionsResult = { resumed: [], remaining: [], stoppedEarly: false };
    expect(formatStartDaySummary(result)).toBe('');
  });
});
