import { describe, expect, it } from 'vitest';
import {
  findHandoffBySessionOrCwd,
  parseInteractiveSelection,
  resolveSelectionMode,
} from '../../../src/cli/start-day-selection.js';
import { createHandoff } from '../core/_fixtures.js';

describe('resolveSelectionMode', () => {
  it('--session wins even when --all is also set', () => {
    expect(resolveSelectionMode({ all: true, session: 'abc' }, true)).toEqual({
      kind: 'session',
      sessionOrCwd: 'abc',
    });
  });

  it('--all wins over the TTY question when neither --session is given', () => {
    expect(resolveSelectionMode({ all: true }, false)).toEqual({ kind: 'all' });
  });

  it('no flags, no TTY: noTtyNoFlag', () => {
    expect(resolveSelectionMode({ all: false }, false)).toEqual({ kind: 'noTtyNoFlag' });
  });

  it('no flags, a real TTY: interactive', () => {
    expect(resolveSelectionMode({ all: false }, true)).toEqual({ kind: 'interactive' });
  });
});

describe('findHandoffBySessionOrCwd', () => {
  const alpha = createHandoff({ sessionId: 'alpha-id', cwd: 'c:\\code\\alpha' });
  const beta = createHandoff({ sessionId: 'beta-id', cwd: 'c:\\code\\beta' });

  it('matches by sessionId', () => {
    expect(findHandoffBySessionOrCwd([alpha, beta], 'alpha-id')).toBe(alpha);
  });

  it('matches by cwd', () => {
    expect(findHandoffBySessionOrCwd([alpha, beta], 'c:\\code\\beta')).toBe(beta);
  });

  it('returns undefined when nothing matches', () => {
    expect(findHandoffBySessionOrCwd([alpha, beta], 'nope')).toBeUndefined();
  });
});

describe('parseInteractiveSelection', () => {
  const alpha = createHandoff({ sessionId: 'alpha-id', name: 'alpha' });
  const beta = createHandoff({ sessionId: 'beta-id', name: 'beta' });
  const candidates = [alpha, beta];

  it('blank means none', () => {
    expect(parseInteractiveSelection('', candidates)).toEqual({ kind: 'none' });
  });

  it('"none" (case-insensitive, with surrounding whitespace) means none', () => {
    expect(parseInteractiveSelection('  None  ', candidates)).toEqual({ kind: 'none' });
  });

  it('"all" (case-insensitive) means every candidate', () => {
    expect(parseInteractiveSelection('ALL', candidates)).toEqual({
      kind: 'chosen',
      handoffs: candidates,
    });
  });

  it('a single number selects that one candidate (1-based)', () => {
    expect(parseInteractiveSelection('1', candidates)).toEqual({
      kind: 'chosen',
      handoffs: [alpha],
    });
  });

  it('a comma-separated list selects several, in candidate order regardless of input order', () => {
    expect(parseInteractiveSelection('2, 1', candidates)).toEqual({
      kind: 'chosen',
      handoffs: [alpha, beta],
    });
  });

  it('duplicate numbers are deduplicated', () => {
    expect(parseInteractiveSelection('1,1,1', candidates)).toEqual({
      kind: 'chosen',
      handoffs: [alpha],
    });
  });

  it('zero is out of range — invalid, not "none"', () => {
    const result = parseInteractiveSelection('0', candidates);
    expect(result.kind).toBe('invalid');
  });

  it('a number past the candidate count is invalid', () => {
    const result = parseInteractiveSelection('3', candidates);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('1 to 2');
    }
  });

  it('non-numeric garbage is invalid, with the offending token named', () => {
    const result = parseInteractiveSelection('banana', candidates);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('"banana"');
    }
  });
});
