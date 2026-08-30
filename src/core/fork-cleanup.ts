/**
 * Pure decision of which forks `seeya` itself created (D-012) are old enough to delete: "forks
 * com mais de `forkCleanupDays` (default 7) são apagados". No I/O here — `now` is the `Clock`
 * port's value (D-019), already resolved by the caller, and `createdAt` is already parsed into a
 * `Date` (or `null`) by the caller too; this module only compares.
 */

export interface ForkAge {
  readonly sessionId: string;
  /**
   * When the fork was created, or `null` when `forks.json`'s entry doesn't carry a usable
   * `createdAt` (a hand-edited entry, or one written before Q-008 fixed the field as required).
   * `null` is NOT read as "old" here — see `planForkCleanup`'s docstring for why.
   */
  readonly createdAt: Date | null;
}

export interface ForkCleanupPlan {
  /** `sessionId`s strictly older than `forkCleanupDays` — safe to delete. */
  readonly stale: readonly string[];
  /** `sessionId`s not old enough yet, or whose age can't be established at all. */
  readonly kept: readonly string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Splits `forks` into `stale` (older than `forkCleanupDays`) and `kept` (everything else).
 *
 * **A fork with `createdAt: null` is always `kept`, never `stale` (D-025).** Absence of the
 * timestamp is not evidence of age — it says nothing about when the fork was created, and reading
 * "no evidence" as "old enough to delete" would be exactly the kind of unearned claim D-025
 * forbids, applied here to a decision that's irreversible (the file is gone once deleted). The
 * least-specific true statement about an age-less fork is "not proven stale", so that's what it
 * gets; a future migration or manual edit that fixes the missing field is what makes it eligible
 * again, not a guess made here.
 *
 * "Mais de `forkCleanupDays`" (D-012) is strict: a fork exactly `forkCleanupDays` days old is
 * still `kept`, one day (in truth, one millisecond) short of being stale.
 */
export function planForkCleanup(
  forks: readonly ForkAge[],
  now: Date,
  forkCleanupDays: number,
): ForkCleanupPlan {
  const stale: string[] = [];
  const kept: string[] = [];
  for (const fork of forks) {
    if (
      fork.createdAt !== null &&
      now.getTime() - fork.createdAt.getTime() > forkCleanupDays * DAY_MS
    ) {
      stale.push(fork.sessionId);
    } else {
      kept.push(fork.sessionId);
    }
  }
  return { stale, kept };
}
