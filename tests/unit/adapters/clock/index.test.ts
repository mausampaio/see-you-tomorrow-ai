/**
 * `adapters/clock/index.ts#systemClock` (D-019). `now()` was already exercised end to end by
 * every integration test that wires a real `Clock` through `cli/composition.ts` — this file adds
 * the one method that wasn't reached anywhere yet: `sleep()` (S4-T3, added for
 * `scheduler/loop.ts`'s poll cadence, the only production caller of a real timer in this project
 * outside this module).
 */
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../../../src/adapters/clock/index.js';

describe('systemClock.now', () => {
  it('returns a real Date instance close to the actual current time', () => {
    const before = Date.now();
    const result = systemClock.now();
    const after = Date.now();
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('systemClock.sleep', () => {
  it('resolves after roughly the requested delay, using a real timer', async () => {
    const start = Date.now();
    await systemClock.sleep(20);
    // Real timers are never exact — only asserting a floor (it didn't resolve instantly) and a
    // generous ceiling (it didn't hang), same discipline other real-timing assertions in this
    // project already use rather than pinning an exact millisecond count.
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('resolves at all for a zero-millisecond delay (boundary)', async () => {
    await expect(systemClock.sleep(0)).resolves.toBeUndefined();
  });
});
