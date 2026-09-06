/**
 * `core/daemon-lock.ts` (S4-T3, D-005's single-instance requirement). Pure decision — no I/O.
 */
import { describe, expect, it } from 'vitest';
import { decideLockAcquisition } from '../../../src/core/daemon-lock.js';

describe('decideLockAcquisition', () => {
  it('acquires when nothing has been written yet (null)', () => {
    expect(decideLockAcquisition(null, false)).toStrictEqual({ kind: 'acquire' });
  });

  it('acquires when the recorded pid is no longer alive (stale lock, previous daemon crashed)', () => {
    const existing = {
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: undefined,
    };
    expect(decideLockAcquisition(existing, false)).toStrictEqual({ kind: 'acquire' });
  });

  it('refuses when the recorded pid is still alive, naming which pid holds it', () => {
    const existing = {
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: undefined,
    };
    expect(decideLockAcquisition(existing, true)).toStrictEqual({
      kind: 'refuse',
      heldByPid: 4242,
    });
  });

  it('the existingIsAlive it decides on already reflects the procStart tie-break — this function only reads that boolean, never procStart itself', () => {
    // decideLockAcquisition never inspects `existing.procStart` directly — the tie-break happens
    // one layer down (scheduler/lock.ts, via ProcessControl.isAlive). This test documents that
    // boundary: a recycled-PID lock and a genuinely dead one look identical to this function once
    // `existingIsAlive` is resolved to `false`.
    const recycled = {
      pid: 4242,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      procStart: 'stale-value-from-a-different-process',
    };
    expect(decideLockAcquisition(recycled, false)).toStrictEqual({ kind: 'acquire' });
  });
});
