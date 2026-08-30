import { describe, expect, it } from 'vitest';
import {
  resolveSessionReference,
  type SessionReference,
} from '../../../src/cli/session-reference.js';

type Candidate = SessionReference;

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: 'c:\\code\\alpha',
    name: 'alpha',
    ...overrides,
  };
}

const toRef = (item: Candidate): SessionReference => item;

describe('resolveSessionReference', () => {
  it('matches by exact sessionId', () => {
    const alpha = candidate();
    const beta = candidate({ sessionId: '22222222-2222-4222-8222-222222222222', name: 'beta' });

    const result = resolveSessionReference([alpha, beta], toRef, alpha.sessionId);

    expect(result).toEqual({ kind: 'found', item: alpha });
  });

  it('matches by a unique sessionId prefix', () => {
    const alpha = candidate({ sessionId: '88881111-0000-4000-8000-000000000000' });
    const beta = candidate({ sessionId: '44442222-0000-4000-8000-000000000000', name: 'beta' });

    const result = resolveSessionReference([alpha, beta], toRef, '88881111');

    expect(result).toEqual({ kind: 'found', item: alpha });
  });

  it('matches by exact display name', () => {
    const alpha = candidate({ name: 'code-6d' });
    const beta = candidate({ sessionId: '22222222-2222-4222-8222-222222222222', name: 'code-9f' });

    const result = resolveSessionReference([alpha, beta], toRef, 'code-6d');

    expect(result).toEqual({ kind: 'found', item: alpha });
  });

  it('matches by cwd, exact spelling', () => {
    const alpha = candidate({ cwd: 'c:\\code\\alpha' });

    const result = resolveSessionReference([alpha], toRef, 'c:\\code\\alpha');

    expect(result).toEqual({ kind: 'found', item: alpha });
  });

  it('matches by cwd through path normalization (separator + trailing slash)', () => {
    const alpha = candidate({ cwd: 'c:\\code\\alpha' });

    const result = resolveSessionReference([alpha], toRef, 'c:/code/alpha/');

    expect(result).toEqual({ kind: 'found', item: alpha });
  });

  it('reports notFound when nothing matches any method', () => {
    const alpha = candidate();

    const result = resolveSessionReference([alpha], toRef, 'nothing-matches-this');

    expect(result).toEqual({ kind: 'notFound' });
  });

  /**
   * The exact scenario S3-T5 exists for: dozens of sessions launched from the same directory. A
   * bare `cwd` match is no longer treated as identifying ONE session — two matches is refused
   * outright, not silently narrowed by picking whichever came first (the old `Array#find`
   * behavior this replaces).
   */
  it('two sessions sharing a cwd: matching by that cwd is ambiguous, never picks one', () => {
    const alpha = candidate({ sessionId: '11111111-1111-4111-8111-111111111111', name: 'alpha' });
    const beta = candidate({ sessionId: '22222222-2222-4222-8222-222222222222', name: 'beta' });

    const result = resolveSessionReference([alpha, beta], toRef, alpha.cwd);

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.matches).toEqual([alpha, beta]);
    }
  });

  it('a sessionId prefix matching two sessions is ambiguous, never picks one', () => {
    const alpha = candidate({ sessionId: '88881111-0000-4000-8000-000000000000', name: 'alpha' });
    const beta = candidate({ sessionId: '88882222-0000-4000-8000-000000000000', name: 'beta' });

    const result = resolveSessionReference([alpha, beta], toRef, '8888');

    expect(result.kind).toBe('ambiguous');
  });

  it('an exact sessionId match is authoritative even if the value would also prefix-match another', () => {
    const exact = candidate({ sessionId: '88881111', name: 'exact' });
    const alsoPrefixed = candidate({
      sessionId: '88881111-more-suffix-that-would-also-prefix-match',
      name: 'longer',
    });

    const result = resolveSessionReference([exact, alsoPrefixed], toRef, '88881111');

    expect(result).toEqual({ kind: 'found', item: exact });
  });

  it('empty string never matches everything by "prefix" — treated as notFound rather than ambiguous-with-all', () => {
    const alpha = candidate();
    const beta = candidate({
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'beta',
      cwd: 'c:\\code\\beta',
    });

    const result = resolveSessionReference([alpha, beta], toRef, '');

    expect(result).toEqual({ kind: 'notFound' });
  });
});
