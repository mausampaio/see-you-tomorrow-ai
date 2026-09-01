import { describe, expect, it } from 'vitest';
import { isCaptureCandidate } from '../../../src/core/capture-scope.js';
import { createSessionWithPid, createSessionWithoutPid } from './_fixtures.js';

/**
 * D-031's scope cut, isolated at the pure-function level. The full pipeline test —
 * "an `unknown` session never reaches eligibility at all" — lives in
 * `tests/unit/application/end-day.test.ts`, since that's the boundary D-031 actually asks to move
 * (docs/PLANO-DE-ENTREGA.md S4-T0b: "ponha o corte de escopo antes da elegibilidade").
 */
describe('isCaptureCandidate — the three D-031 populations', () => {
  it('a live session (registry + live PID) is a capture candidate', () => {
    const session = createSessionWithPid({ processIsAlive: true });
    expect(isCaptureCandidate(session)).toBe(true);
  });

  it(
    'an ended session (registry + dead PID) is STILL a capture candidate — the line that looks ' +
      'like a concession and is not (D-031)',
    () => {
      const session = createSessionWithPid({ processIsAlive: false });
      expect(isCaptureCandidate(session)).toBe(true);
    },
  );

  it('a transcript-only session (no registry entry, sessionState "unknown") is never a capture candidate', () => {
    const session = createSessionWithoutPid();
    expect(isCaptureCandidate(session)).toBe(false);
  });
});
