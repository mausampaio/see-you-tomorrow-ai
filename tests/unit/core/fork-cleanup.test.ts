import { describe, expect, it } from 'vitest';
import { planForkCleanup, type ForkAge } from '../../../src/core/fork-cleanup.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const FORK_CLEANUP_DAYS = 7;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

describe('planForkCleanup', () => {
  it('a fork strictly older than forkCleanupDays is stale', () => {
    const forks: ForkAge[] = [{ sessionId: 'a', createdAt: daysAgo(8) }];

    const plan = planForkCleanup(forks, NOW, FORK_CLEANUP_DAYS);

    expect(plan).toStrictEqual({ stale: ['a'], kept: [] });
  });

  it('a fork younger than forkCleanupDays is kept', () => {
    const forks: ForkAge[] = [{ sessionId: 'a', createdAt: daysAgo(3) }];

    const plan = planForkCleanup(forks, NOW, FORK_CLEANUP_DAYS);

    expect(plan).toStrictEqual({ stale: [], kept: ['a'] });
  });

  it('a fork exactly forkCleanupDays old is kept — D-012 says "mais de", strictly greater', () => {
    const forks: ForkAge[] = [{ sessionId: 'a', createdAt: daysAgo(FORK_CLEANUP_DAYS) }];

    const plan = planForkCleanup(forks, NOW, FORK_CLEANUP_DAYS);

    expect(plan).toStrictEqual({ stale: [], kept: ['a'] });
  });

  it('one millisecond past forkCleanupDays is stale — the other side of the same boundary', () => {
    const oneMsPastLimit = new Date(NOW.getTime() - FORK_CLEANUP_DAYS * DAY_MS - 1);
    const forks: ForkAge[] = [{ sessionId: 'a', createdAt: oneMsPastLimit }];

    const plan = planForkCleanup(forks, NOW, FORK_CLEANUP_DAYS);

    expect(plan).toStrictEqual({ stale: ['a'], kept: [] });
  });

  it('a fork with unknown age (createdAt: null) is kept, never assumed stale (D-025)', () => {
    const forks: ForkAge[] = [{ sessionId: 'a', createdAt: null }];

    const plan = planForkCleanup(forks, NOW, FORK_CLEANUP_DAYS);

    expect(plan).toStrictEqual({ stale: [], kept: ['a'] });
  });

  it('splits a mixed batch correctly, preserving no particular order requirement per side', () => {
    const forks: ForkAge[] = [
      { sessionId: 'stale-1', createdAt: daysAgo(30) },
      { sessionId: 'recent-1', createdAt: daysAgo(1) },
      { sessionId: 'unknown-age', createdAt: null },
      { sessionId: 'stale-2', createdAt: daysAgo(10) },
    ];

    const plan = planForkCleanup(forks, NOW, FORK_CLEANUP_DAYS);

    expect([...plan.stale].sort()).toStrictEqual(['stale-1', 'stale-2']);
    expect([...plan.kept].sort()).toStrictEqual(['recent-1', 'unknown-age']);
  });

  it('an empty registry produces an empty plan', () => {
    expect(planForkCleanup([], NOW, FORK_CLEANUP_DAYS)).toStrictEqual({ stale: [], kept: [] });
  });
});
