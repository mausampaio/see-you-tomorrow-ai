import { describe, expect, it } from 'vitest';
import { mapWithConcurrencyLimit } from '../../../src/application/concurrency.js';

describe('mapWithConcurrencyLimit', () => {
  it('returns results in the same order as the input, regardless of settle order', async () => {
    const delays = [30, 10, 20];
    const results = await mapWithConcurrencyLimit(delays, 3, (delay) => {
      return new Promise<number>((resolve) => setTimeout(() => resolve(delay), delay));
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrencyLimit(items, 3, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await mapWithConcurrencyLimit([1, 2, 3, 4, 5], 2, (item) => {
      seen.push(item);
      return Promise.resolve(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('an empty item list resolves to an empty array without hanging', async () => {
    const results = await mapWithConcurrencyLimit<number, number>([], 3, (item) =>
      Promise.resolve(item),
    );
    expect(results).toEqual([]);
  });

  it('a non-positive limit is treated as 1, not a hang', async () => {
    const results = await mapWithConcurrencyLimit([1, 2], 0, (item) => Promise.resolve(item * 2));
    expect(results).toEqual([2, 4]);
  });

  it('a limit larger than the item count still runs every item once', async () => {
    const results = await mapWithConcurrencyLimit([1, 2], 100, (item) => Promise.resolve(item));
    expect(results).toEqual([1, 2]);
  });

  it('a rejection from one task propagates out of mapWithConcurrencyLimit', async () => {
    await expect(
      mapWithConcurrencyLimit([1, 2, 3], 2, (item) =>
        item === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(item),
      ),
    ).rejects.toThrow('boom');
  });
});
