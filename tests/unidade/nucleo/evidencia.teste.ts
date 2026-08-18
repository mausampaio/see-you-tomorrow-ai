import { describe, expect, it } from 'vitest';
import { sameEvidence } from '../../../src/nucleo/evidencia.js';

describe('sameEvidence', () => {
  it('two empty signatures are not "the same evidence" — nothing to confirm (D-025)', () => {
    expect(sameEvidence({}, {})).toBe(false);
  });

  it('one source with the same value on both sides confirms the same evidence', () => {
    expect(sameEvidence({ transcript: 'abc' }, { transcript: 'abc' })).toBe(true);
  });

  it('one source with different values indicates the evidence changed', () => {
    expect(sameEvidence({ transcript: 'abc' }, { transcript: 'def' })).toBe(false);
  });

  it('an absent source (null) on both sides decides nothing — passes to the rest (D-025/D-026)', () => {
    // transcript absent in both captures; git is the only source with a value and it's equal in both.
    expect(sameEvidence({ transcript: null, git: 'sha-1' }, { transcript: null, git: 'sha-1' })).toBe(
      true,
    );
  });

  it(
    'two captures without a transcript, with git changed between them, are NOT the same evidence ' +
      '(D-026 — the autonomous execution agent case)',
    () => {
      expect(sameEvidence({ transcript: null, git: 'sha-1' }, { transcript: null, git: 'sha-2' })).toBe(
        false,
      );
    },
  );

  it('every source absent (null) on both sides confirms nothing — not the same evidence', () => {
    expect(sameEvidence({ transcript: null, git: null }, { transcript: null, git: null })).toBe(
      false,
    );
  });

  it('a source that appears (absent before, present now) counts as a change', () => {
    expect(sameEvidence({ transcript: null }, { transcript: 'abc' })).toBe(false);
  });

  it('a source that disappears (present before, absent now) counts as a change', () => {
    expect(sameEvidence({ transcript: 'abc' }, { transcript: null })).toBe(false);
  });

  it('a key present in only one of the two objects is treated as absent in the other', () => {
    expect(sameEvidence({ transcript: 'abc' }, {})).toBe(false);
    expect(sameEvidence({}, { transcript: 'abc' })).toBe(false);
  });

  it('multiple sources: one confirms, but another changed — result is "changed" (short-circuit)', () => {
    expect(
      sameEvidence({ transcript: 'abc', git: 'sha-1' }, { transcript: 'abc', git: 'sha-2' }),
    ).toBe(false);
  });

  it('multiple sources, all equal — result is "same evidence"', () => {
    expect(
      sameEvidence(
        { transcript: 'abc', git: 'sha-1', registry: 'name-x' },
        { transcript: 'abc', git: 'sha-1', registry: 'name-x' },
      ),
    ).toBe(true);
  });
});
