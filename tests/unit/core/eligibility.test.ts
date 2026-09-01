import { describe, expect, it } from 'vitest';
import { evaluateEligibility, type EligibilityCriteria } from '../../../src/core/eligibility.js';
import { createSessionWithPid } from './_fixtures.js';

const NOW = new Date('2026-08-16T20:00:00.000Z');

function criteria(overrides: Partial<EligibilityCriteria> = {}): EligibilityCriteria {
  return {
    now: NOW,
    relevanceHours: 12,
    ignoredCwds: new Set<string>(),
    knownForks: new Set<string>(),
    previousCaptureToday: null,
    currentSignature: {},
    ...overrides,
  };
}

describe('evaluateEligibility', () => {
  it('a session that passes all five conditions is eligible, with no reasons', () => {
    const session = createSessionWithPid({ lastActivity: new Date('2026-08-16T10:00:00.000Z') });

    const result = evaluateEligibility(session, criteria());

    expect(result).toStrictEqual({ eligible: true, reasons: [] });
  });

  describe('condition 1 — at least one evidence source answered', () => {
    it('null lastActivity (no source answered) makes the session ineligible', () => {
      const session = createSessionWithPid({ lastActivity: null });

      const result = evaluateEligibility(session, criteria());

      expect(result.eligible).toBe(false);
      expect(result.reasons).toStrictEqual(['noEvidence']);
    });
  });

  describe('condition 2 — activity within relevanceHours', () => {
    it('activity exactly at the relevanceHours limit is still eligible (strictly >)', () => {
      const exactlyTwelveHoursAgo = new Date(NOW.getTime() - 12 * 3_600_000);
      const session = createSessionWithPid({ lastActivity: exactlyTwelveHoursAgo });

      const result = evaluateEligibility(session, criteria({ relevanceHours: 12 }));

      expect(result.eligible).toBe(true);
    });

    it('activity one millisecond past the limit is already ineligible', () => {
      const oneMsPastTheLimit = new Date(NOW.getTime() - (12 * 3_600_000 + 1));
      const session = createSessionWithPid({ lastActivity: oneMsPastTheLimit });

      const result = evaluateEligibility(session, criteria({ relevanceHours: 12 }));

      expect(result.eligible).toBe(false);
      expect(result.reasons).toStrictEqual(['noRecentActivity']);
    });

    it('noEvidence and noRecentActivity never appear together (they are two faces of the same field)', () => {
      const session = createSessionWithPid({ lastActivity: null });

      const result = evaluateEligibility(session, criteria());

      expect(result.reasons).not.toContain('noRecentActivity');
    });
  });

  describe("condition 3 — not seeya's own fork (D-012)", () => {
    it('sessionId present in knownForks makes the session ineligible', () => {
      const session = createSessionWithPid({ sessionId: '33333333-3333-4333-8333-333333333333' });

      const result = evaluateEligibility(
        session,
        criteria({ knownForks: new Set(['33333333-3333-4333-8333-333333333333']) }),
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons).toStrictEqual(['ownSeeyaFork']);
    });

    it('a known fork with a different sessionId does not affect eligibility', () => {
      const session = createSessionWithPid({ sessionId: '44444444-4444-4444-8444-444444444444' });

      const result = evaluateEligibility(
        session,
        criteria({ knownForks: new Set(['99999999-9999-4999-8999-999999999999']) }),
      );

      expect(result.eligible).toBe(true);
    });

    // A third test lived here between S1-T10 and S1-T11, covering `SessionWithoutSessionId`
    // (D-023), a shape with no `sessionId` at all that `evaluateEligibility` had to narrow around
    // before reading `session.sessionId`. Removed with that shape — see docs/DECISOES.md D-029.
  });

  describe('condition 4 — cwd is not in the ignore list', () => {
    it('cwd present in ignoredCwds makes the session ineligible', () => {
      const session = createSessionWithPid({ cwd: 'c:\\code\\rascunhos' });

      const result = evaluateEligibility(
        session,
        criteria({ ignoredCwds: new Set(['c:\\code\\rascunhos']) }),
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons).toStrictEqual(['ignoredCwd']);
    });

    it('edge combination: relevant session (recent activity) but ignored cwd', () => {
      const session = createSessionWithPid({
        cwd: 'c:\\code\\rascunhos',
        lastActivity: new Date('2026-08-16T19:59:00.000Z'), // 1 minute ago — very relevant
      });

      const result = evaluateEligibility(
        session,
        criteria({ ignoredCwds: new Set(['c:\\code\\rascunhos']) }),
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons).toStrictEqual(['ignoredCwd']);
    });
  });

  describe('condition 5 — anti-duplication compares the evidence signature (D-026)', () => {
    it('with no previous capture today, the session is eligible regardless of the current signature', () => {
      const session = createSessionWithPid();

      const result = evaluateEligibility(
        session,
        criteria({ previousCaptureToday: null, currentSignature: { transcript: 'abc' } }),
      );

      expect(result.eligible).toBe(true);
    });

    it('an identical signature between the last capture and now makes the session ineligible', () => {
      const session = createSessionWithPid();

      const result = evaluateEligibility(
        session,
        criteria({
          previousCaptureToday: {
            signature: { transcript: '2026-08-16T18:00:00.000Z' },
            source: 'model',
          },
          currentSignature: { transcript: '2026-08-16T18:00:00.000Z' },
        }),
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons).toStrictEqual(['duplicateToday']);
    });

    it("edge combination: today's handoff exists but the signature changed — eligible again", () => {
      const session = createSessionWithPid();

      const result = evaluateEligibility(
        session,
        criteria({
          previousCaptureToday: {
            signature: { transcript: '2026-08-16T18:00:00.000Z' },
            source: 'model',
          },
          currentSignature: { transcript: '2026-08-16T19:50:00.000Z' },
        }),
      );

      expect(result.eligible).toBe(true);
    });

    it(
      'D-026: two captures without a transcript, but with git changed between them, are NOT ' +
        'duplicates — the autonomous execution agent case (D-013)',
      () => {
        const session = createSessionWithPid();

        const result = evaluateEligibility(
          session,
          criteria({
            previousCaptureToday: {
              signature: { transcript: null, git: 'sha-1' },
              source: 'model',
            },
            currentSignature: { transcript: null, git: 'sha-2' },
          }),
        );

        expect(result.eligible).toBe(true);
      },
    );

    it(
      'two captures with every source absent (null) on both sides are NOT treated as ' +
        'duplicates — absence of data does not become a positive claim (D-025/D-026)',
      () => {
        const session = createSessionWithPid();

        const result = evaluateEligibility(
          session,
          criteria({
            previousCaptureToday: { signature: { transcript: null, git: null }, source: 'model' },
            currentSignature: { transcript: null, git: null },
          }),
        );

        expect(result.eligible).toBe(true);
      },
    );

    describe('S4-T00e: only a model handoff can make today "already captured"', () => {
      it(
        'a deterministic previous capture (generation was attempted and FAILED) does not block ' +
          're-capture, even with an unchanged signature — a failed call is not a verdict (D-025)',
        () => {
          const session = createSessionWithPid();

          const result = evaluateEligibility(
            session,
            criteria({
              previousCaptureToday: {
                signature: { transcript: '2026-08-16T18:00:00.000Z' },
                source: 'deterministic',
              },
              currentSignature: { transcript: '2026-08-16T18:00:00.000Z' },
            }),
          );

          expect(result).toStrictEqual({ eligible: true, reasons: [] });
        },
      );

      it(
        'a noTranscript previous capture (the model was never called) does not block ' +
          're-capture either, even with an unchanged signature',
        () => {
          const session = createSessionWithPid();

          const result = evaluateEligibility(
            session,
            criteria({
              previousCaptureToday: {
                signature: { transcript: '2026-08-16T18:00:00.000Z' },
                source: 'noTranscript',
              },
              currentSignature: { transcript: '2026-08-16T18:00:00.000Z' },
            }),
          );

          expect(result).toStrictEqual({ eligible: true, reasons: [] });
        },
      );

      it('a model previous capture still blocks with an unchanged signature (regression guard)', () => {
        const session = createSessionWithPid();

        const result = evaluateEligibility(
          session,
          criteria({
            previousCaptureToday: {
              signature: { transcript: '2026-08-16T18:00:00.000Z' },
              source: 'model',
            },
            currentSignature: { transcript: '2026-08-16T18:00:00.000Z' },
          }),
        );

        expect(result).toStrictEqual({ eligible: false, reasons: ['duplicateToday'] });
      });
    });
  });

  it('accumulates every applicable reason, not just the first', () => {
    const session = createSessionWithPid({
      sessionId: '55555555-5555-4555-8555-555555555555',
      cwd: 'c:\\code\\rascunhos',
      lastActivity: null,
    });

    const result = evaluateEligibility(
      session,
      criteria({
        knownForks: new Set(['55555555-5555-4555-8555-555555555555']),
        ignoredCwds: new Set(['c:\\code\\rascunhos']),
      }),
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toStrictEqual(
      expect.arrayContaining(['noEvidence', 'ownSeeyaFork', 'ignoredCwd']),
    );
    expect(result.reasons).toHaveLength(3);
  });
});
