import { describe, expect, it } from 'vitest';
import {
  formatInvalidSelection,
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
    expect(formatNoPendingBriefing(31)).toContain('31 days scanned');
  });

  // The scan bound is 30 today, so this branch never shows up in real output — but "1 day" is the
  // only reading that is correct if it ever does, and the message used to sidestep the question
  // entirely with "day(s)".
  it('agrees with a singular count', () => {
    expect(formatNoPendingBriefing(1)).toContain('1 day scanned');
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

  it('says nothing extra when no normalized value is given', () => {
    expect(formatNoSessionMatch('nothing-like-this')).not.toContain('matched against');
  });

  // Seam for S3-T5's path normalization (docs/PLANO-DE-ENTREGA.md): once a caller has both the
  // raw `--session` value and what it actually compared against handoffs, showing both reveals a
  // value a shell silently mangled (e.g. Git Bash eating backslashes out of a Windows path)
  // instead of a bare "no match" that looks like an ordinary typo.
  it('also shows what it was matched against, when that differs from the received value', () => {
    const message = formatNoSessionMatch('C:Usersmausa', 'c:usersmausa');
    expect(message).toContain('"C:Usersmausa"');
    expect(message).toContain('matched against "c:usersmausa"');
  });

  it('does not repeat the value when the normalized form is identical to what was received', () => {
    const message = formatNoSessionMatch('nothing-like-this', 'nothing-like-this');
    expect(message).not.toContain('matched against');
  });
});

describe('formatInvalidSelection', () => {
  it('carries the original reason, and states plainly that nothing was resumed', () => {
    const message = formatInvalidSelection(
      '"banana" is not a valid option (expected a number from 1 to 2, "all", or blank for none)',
    );
    expect(message).toContain('"banana" is not a valid option');
    expect(message).toContain('Nothing was resumed');
  });

  it('points at --help instead of duplicating --all/--session syntax inline', () => {
    const message = formatInvalidSelection('bad input');
    expect(message).toContain('seeya start-day --help');
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
