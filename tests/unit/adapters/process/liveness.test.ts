import { describe, expect, it, vi } from 'vitest';
import {
  errorCode,
  interpretExistenceCheckError,
  resolveIsAlive,
  type ProcStartCapture,
} from '../../../../src/adapters/process/liveness.js';

describe('errorCode', () => {
  it('reads .code off an error-shaped object', () => {
    expect(errorCode({ code: 'ESRCH' })).toBe('ESRCH');
  });

  it('is undefined for null, primitives, and objects with no .code', () => {
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode('boom')).toBeUndefined();
    expect(errorCode(new Error('boom'))).toBeUndefined();
    expect(errorCode({})).toBeUndefined();
  });
});

describe('interpretExistenceCheckError', () => {
  it('EPERM means the process exists — "alive" (pitfall 2, not "dead")', () => {
    expect(interpretExistenceCheckError({ code: 'EPERM' })).toBe('alive');
  });

  it('rethrows the original error, unmodified, for any other code', () => {
    const original = Object.assign(new Error('mystery'), { code: 'EWEIRD' });
    expect(() => interpretExistenceCheckError(original)).toThrow(original);
  });

  it('rethrows when there is no .code at all — never guesses "dead" on the unknown', () => {
    const original = new Error('no code here');
    expect(() => interpretExistenceCheckError(original)).toThrow(original);
  });
});

describe('resolveIsAlive', () => {
  const alwaysSameProcess = () => true;
  const alwaysDifferentProcess = () => false;

  it('a dead PID is never alive, even with a matching-looking capture', () => {
    const capture: ProcStartCapture = { kind: 'value', value: 'X' };
    expect(resolveIsAlive(false, 'X', capture, alwaysSameProcess)).toBe(false);
  });

  it('PID exists, no procStart requested: alive, no tie-break needed', () => {
    expect(resolveIsAlive(true, undefined, undefined, alwaysSameProcess)).toBe(true);
  });

  it('PID exists, procStart requested but no capture given: falls back to basic liveness', () => {
    expect(resolveIsAlive(true, 'X', undefined, alwaysSameProcess)).toBe(true);
  });

  it('PID exists but vanished before the procStart read (processGone): not alive', () => {
    const capture: ProcStartCapture = { kind: 'processGone' };
    expect(resolveIsAlive(true, 'X', capture, alwaysSameProcess)).toBe(false);
  });

  /**
   * D-025 (docs/PLANO-DE-ENTREGA.md S1-T2 aceite item 4): the tie-break couldn't be evaluated —
   * not "compared and it's a different process". Must not collapse into `false`.
   */
  it('procStart could not be captured/compared (unavailable): NOT false — falls back to alive', () => {
    const capture: ProcStartCapture = { kind: 'unavailable', reason: 'ps not found' };
    expect(resolveIsAlive(true, 'X', capture, alwaysDifferentProcess)).toBe(true);
  });

  /**
   * Aceite item 3: PID recycling. The OS handed the same PID to an unrelated process; the
   * observed procStart genuinely differs from the one recorded at discovery time.
   */
  it('procStart was captured and genuinely diverges (PID recycled): not alive', () => {
    const capture: ProcStartCapture = { kind: 'value', value: 'observed-999' };
    expect(resolveIsAlive(true, 'registered-123', capture, alwaysDifferentProcess)).toBe(false);
  });

  it('procStart was captured and matches: alive', () => {
    const capture: ProcStartCapture = { kind: 'value', value: 'same-123' };
    expect(resolveIsAlive(true, 'same-123', capture, alwaysSameProcess)).toBe(true);
  });

  it('delegates the actual comparison to the injected sameProcess, in (registered, observed) order', () => {
    const sameProcess = vi.fn(() => true);
    const capture: ProcStartCapture = { kind: 'value', value: 'observed' };
    resolveIsAlive(true, 'registered', capture, sameProcess);
    expect(sameProcess).toHaveBeenCalledWith('registered', 'observed');
  });
});
