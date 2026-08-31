import { describe, expect, it } from 'vitest';
import { buildEvidenceSignature, sameEvidence } from '../../../src/core/evidence.js';
import type { HandoffFacts } from '../../../src/core/types.js';

const NO_EVIDENCE_FACTS: HandoffFacts = {
  lastActivity: null,
  lastPrompts: [],
  assistantMessages: [],
  touchedFiles: [],
  git: null,
};

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
    expect(
      sameEvidence({ transcript: null, git: 'sha-1' }, { transcript: null, git: 'sha-1' }),
    ).toBe(true);
  });

  it(
    'two captures without a transcript, with git changed between them, are NOT the same evidence ' +
      '(D-026 — the autonomous execution agent case)',
    () => {
      expect(
        sameEvidence({ transcript: null, git: 'sha-1' }, { transcript: null, git: 'sha-2' }),
      ).toBe(false);
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

describe('buildEvidenceSignature (D-026)', () => {
  it('no evidence at all — both tokens null', () => {
    expect(buildEvidenceSignature(NO_EVIDENCE_FACTS)).toEqual({ transcript: null, git: null });
  });

  it('transcript token is the ISO instant of lastActivity when present', () => {
    const facts: HandoffFacts = {
      ...NO_EVIDENCE_FACTS,
      lastActivity: new Date('2026-08-16T20:00:00.000Z'),
    };
    expect(buildEvidenceSignature(facts).transcript).toBe('2026-08-16T20:00:00.000Z');
  });

  it('git token is null when there is no repository at all (hasGit: false)', () => {
    expect(buildEvidenceSignature(NO_EVIDENCE_FACTS).git).toBeNull();
  });

  it('git token changes when the git facts change — the autonomous-agent case (D-026)', () => {
    const before: HandoffFacts = {
      ...NO_EVIDENCE_FACTS,
      git: {
        branch: 'main',
        dirty: false,
        modifiedFiles: [],
        commitsToday: [],
        worktrees: [],
      },
    };
    const after: HandoffFacts = {
      ...NO_EVIDENCE_FACTS,
      git: {
        branch: 'main',
        dirty: true,
        modifiedFiles: ['src/a.ts'],
        commitsToday: [{ sha: '1b7fd99', title: 'docs: especificação inicial' }],
        worktrees: [],
      },
    };
    const beforeSignature = buildEvidenceSignature(before);
    const afterSignature = buildEvidenceSignature(after);
    expect(beforeSignature.git).not.toBeNull();
    expect(afterSignature.git).not.toBeNull();
    expect(beforeSignature.git).not.toBe(afterSignature.git);
    expect(sameEvidence(beforeSignature, afterSignature)).toBe(false);
  });

  it('identical git facts produce the identical token — same evidence confirms', () => {
    const facts: HandoffFacts = {
      ...NO_EVIDENCE_FACTS,
      git: { branch: 'main', dirty: false, modifiedFiles: [], commitsToday: [], worktrees: [] },
    };
    const first = buildEvidenceSignature(facts);
    const second = buildEvidenceSignature({ ...facts });
    expect(sameEvidence(first, second)).toBe(true);
  });
});
