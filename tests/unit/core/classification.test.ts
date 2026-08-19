import { describe, expect, it } from 'vitest';
import {
  classifyState,
  pidRepresentsSameProcess,
  type ClassificationParams,
} from '../../../src/core/classification.js';
import { createSessionWithPid, createSessionWithoutPid } from './_fixtures.js';

const NOW = new Date('2026-08-16T20:45:00.000Z');
const DEFAULT_PARAMS: ClassificationParams = { now: NOW, idleMinutes: 45 };

describe('classifyState', () => {
  it('session without a PID is always "unknown" (D-016), regardless of any other field', () => {
    const session = createSessionWithoutPid({
      lastTranscriptWrite: NOW,
      lastActivity: NOW,
    });

    expect(classifyState(session, DEFAULT_PARAMS)).toBe('unknown');
  });

  it('session without a PID and without any transcript at all is also "unknown", not "ended"', () => {
    const session = createSessionWithoutPid({
      hasTranscript: false,
      lastTranscriptWrite: null,
    });

    expect(classifyState(session, DEFAULT_PARAMS)).toBe('unknown');
  });

  it('process with a PID but not alive is "ended" (stale entry, D-016)', () => {
    const session = createSessionWithPid({
      processIsAlive: false,
      lastTranscriptWrite: NOW, // even with a recent transcript, dead is dead
    });

    expect(classifyState(session, DEFAULT_PARAMS)).toBe('ended');
  });

  it('process alive with a transcript write within the window is "alive"', () => {
    const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60_000);
    const session = createSessionWithPid({
      processIsAlive: true,
      lastTranscriptWrite: tenMinutesAgo,
    });

    expect(classifyState(session, DEFAULT_PARAMS)).toBe('alive');
  });

  it('process alive with no write for more than idleMinutes is "idle"', () => {
    const fiftyMinutesAgo = new Date(NOW.getTime() - 50 * 60_000);
    const session = createSessionWithPid({
      processIsAlive: true,
      lastTranscriptWrite: fiftyMinutesAgo,
    });

    expect(classifyState(session, DEFAULT_PARAMS)).toBe('idle');
  });

  it('edge: exactly idleMinutes of silence is still "alive" (strictly >)', () => {
    const exactlyFortyFiveMinutesAgo = new Date(NOW.getTime() - 45 * 60_000);
    const session = createSessionWithPid({
      processIsAlive: true,
      lastTranscriptWrite: exactlyFortyFiveMinutesAgo,
    });

    expect(classifyState(session, DEFAULT_PARAMS)).toBe('alive');
  });

  it('edge: one millisecond past idleMinutes is already "idle"', () => {
    const oneMsPastTheLimit = new Date(NOW.getTime() - (45 * 60_000 + 1));
    const session = createSessionWithPid({
      processIsAlive: true,
      lastTranscriptWrite: oneMsPastTheLimit,
    });

    expect(classifyState(session, DEFAULT_PARAMS)).toBe('idle');
  });

  /**
   * D-025: absence of data doesn't become a claim about the world. The two cases always
   * together — without the first, someone "optimizes" the check back into treating `null` as
   * if it were an old timestamp.
   */
  describe('D-025 — null is not evidence of idleness', () => {
    it('process alive with no transcript at all (null) is "alive", not "idle"', () => {
      const session = createSessionWithPid({
        processIsAlive: true,
        hasTranscript: false,
        lastTranscriptWrite: null,
      });

      expect(classifyState(session, DEFAULT_PARAMS)).toBe('alive');
    });

    it('process alive with a real timestamp past the limit stays "idle"', () => {
      const fiftyMinutesAgo = new Date(NOW.getTime() - 50 * 60_000);
      const session = createSessionWithPid({
        processIsAlive: true,
        hasTranscript: true,
        lastTranscriptWrite: fiftyMinutesAgo,
      });

      expect(classifyState(session, DEFAULT_PARAMS)).toBe('idle');
    });
  });

  // A third describe block lived here between S1-T10 and S1-T11, proving that
  // `SessionWithoutSessionId` (D-023) always classified as "alive". Removed with that shape —
  // see docs/DECISOES.md D-029.
});

describe('pidRepresentsSameProcess', () => {
  it('identical procStart values represent the same process', () => {
    expect(pidRepresentsSameProcess('134313811658518463', '134313811658518463')).toBe(true);
  });

  it('divergent procStart values indicate a PID recycled by the OS — a different process', () => {
    expect(pidRepresentsSameProcess('134313811658518463', '999999999999999999')).toBe(false);
  });

  it(
    'combined use: PID "alive" on the OS but with a procStart diverging from the registered one ' +
      'becomes "ended" in classification (docs/TESTES.md: liveness with a recycled PID)',
    () => {
      const registeredProcStart = '134313811658518463';
      const observedProcStartNow = '999999999999999999'; // another process reused the PID

      const sameProcess = pidRepresentsSameProcess(registeredProcStart, observedProcStartNow);
      expect(sameProcess).toBe(false);

      // `processIsAlive` is the already-resolved result of ProcessControl.isAlive(pid,
      // procStart) — simulated here as the result of the tie-break above: the PID exists on
      // the OS, but it's not the same process, so `isAlive` would have returned `false`.
      const session = createSessionWithPid({
        procStart: registeredProcStart,
        processIsAlive: sameProcess,
      });

      expect(classifyState(session, DEFAULT_PARAMS)).toBe('ended');
    },
  );
});
