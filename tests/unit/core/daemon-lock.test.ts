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
    const existing = { pid: 4242, startedAt: new Date('2026-09-01T00:00:00.000Z') };
    expect(decideLockAcquisition(existing, false)).toStrictEqual({ kind: 'acquire' });
  });

  it('refuses when the recorded pid is still alive, naming which pid holds it', () => {
    const existing = { pid: 4242, startedAt: new Date('2026-09-01T00:00:00.000Z') };
    expect(decideLockAcquisition(existing, true)).toStrictEqual({
      kind: 'refuse',
      heldByPid: 4242,
    });
  });
});
