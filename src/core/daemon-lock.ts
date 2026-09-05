/**
 * S4-T3's single-instance decision (D-005: "lockfile em `~/.seeya/daemon.lock` com PID e
 * verificação de liveness"). Pure: given what the lock file already says (or `null`, nothing
 * written yet) and whether that PID is still alive — a fact only `ProcessControl.isAlive`
 * (`core/ports.ts`) can answer, resolved by the caller before this runs — decide whether a new
 * daemon may start.
 *
 * **Known, accepted limitation: no `procStart` tie-break here**, unlike the Claude Code session
 * registry this project reads elsewhere (`core/classification.ts#pidRepresentsSameProcess`). If a
 * daemon dies uncleanly and the OS recycles its PID for an unrelated process before the next
 * `seeya daemon` runs, this decides `'refuse'` on a false positive — a real daemon instance fails
 * to start because an unrelated process happens to be alive at the old PID. Accepted because the
 * consequence is small and recoverable (the person deletes `daemon.lock`, or S4-T5's
 * `--status`/`--stop` gives a real diagnostic path once it exists) — nothing here silently runs two
 * daemons, which is the actual failure D-005 exists to prevent. Adding the same tie-break the
 * session registry uses would need this project's own process to record its OWN start time at
 * spawn, a capability `adapters/process/proc-start.ts` today only offers for re-observing an
 * ALREADY-KNOWN pid, not for a fresh self-description — a real feature, not a two-line addition,
 * for a risk this narrow.
 */

/** What `daemon.lock` records (`adapters/storage/daemon-lock-schema.ts`'s on-disk shape). */
export interface DaemonLockInfo {
  readonly pid: number;
  /** When this lock was written — diagnostic only today (no reader compares it), kept because
   * S4-T5's `seeya daemon --status` will want to say "running since" without a second write. */
  readonly startedAt: Date;
}

export type LockAcquisitionDecision =
  { readonly kind: 'acquire' } | { readonly kind: 'refuse'; readonly heldByPid: number };

/**
 * `existing === null` (nothing written yet, D-025: absence, not corruption) or `existingIsAlive ===
 * false` (the recorded PID is gone — the previous daemon crashed or was killed without cleaning up
 * its own lock) both resolve to `'acquire'`. Only a live, currently-held lock refuses.
 *
 * @example
 * const lock = await storage.readDaemonLock();
 * const alive = lock === null ? false : await processControl.isAlive(lock.pid);
 * const decision = decideLockAcquisition(lock, alive);
 */
export function decideLockAcquisition(
  existing: DaemonLockInfo | null,
  existingIsAlive: boolean,
): LockAcquisitionDecision {
  if (existing === null || !existingIsAlive) {
    return { kind: 'acquire' };
  }
  return { kind: 'refuse', heldByPid: existing.pid };
}
