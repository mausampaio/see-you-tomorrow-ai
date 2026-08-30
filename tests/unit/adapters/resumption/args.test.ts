import { describe, expect, it } from 'vitest';
import {
  buildFallbackArgs,
  buildResumeArgs,
  FALLBACK_KICKOFF_PROMPT,
  RESUME_PROMPT_ARG_LIMIT_CHARS,
} from '../../../../src/adapters/resumption/args.js';

describe('buildResumeArgs — S3-T2, D-015 as corrected', () => {
  it('puts --resume, the session id, and the prompt as the last positional argument', () => {
    const args = buildResumeArgs('11111111-1111-4111-8111-111111111111', 'Yesterday you were...');
    expect(args).toStrictEqual([
      '--resume',
      '11111111-1111-4111-8111-111111111111',
      'Yesterday you were...',
    ]);
  });

  it('never uses -p — plain interactive mode is what attaches to the inherited terminal', () => {
    const args = buildResumeArgs('some-id', 'a prompt');
    expect(args).not.toContain('-p');
    expect(args).not.toContain('--print');
  });

  it('passes a prompt containing quotes, newlines and accents through unchanged', () => {
    const tricky = 'Line one "quoted" and \'single\'.\nLinha com acento: ação, café.\n100% done.';
    const args = buildResumeArgs('some-id', tricky);
    expect(args[2]).toBe(tricky);
  });
});

describe('buildFallbackArgs — D-004 single fallback mechanism', () => {
  it('never uses --resume: the fallback always opens a fresh session', () => {
    const args = buildFallbackArgs('/tmp/seeya/tmp/resume-fallback-x.txt');
    expect(args).not.toContain('--resume');
  });

  it('points --append-system-prompt-file at the given path and adds the fixed kickoff prompt', () => {
    const args = buildFallbackArgs('/tmp/seeya/tmp/resume-fallback-x.txt');
    expect(args).toStrictEqual([
      '--append-system-prompt-file',
      '/tmp/seeya/tmp/resume-fallback-x.txt',
      FALLBACK_KICKOFF_PROMPT,
    ]);
  });
});

describe('RESUME_PROMPT_ARG_LIMIT_CHARS', () => {
  it('sits well under the Windows ~32,767-UTF-16-unit command-line ceiling (Spike H)', () => {
    expect(RESUME_PROMPT_ARG_LIMIT_CHARS).toBeLessThan(32_767 / 4);
  });
});
