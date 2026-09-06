/**
 * S4-T3's single-instance decision (D-005: "lockfile em `~/.seeya/daemon.lock` com PID e
 * verificação de liveness"). Pure: given what the lock file already says (or `null`, nothing
 * written yet) and whether that PID is still alive — a fact only `ProcessControl.isAlive`
 * (`core/ports.ts`) can answer, resolved by the caller before this runs — decide whether a new
 * daemon may start.
 *
 * **S4-T3b added the `procStart` tie-break this file's own text used to say wasn't worth
 * building.** The original reasoning (S4-T3, `docs/QUESTOES.md` Q-049 item 6) was that this
 * project's own process had no way to describe its OWN start time at spawn — `adapters/process/
 * proc-start.ts#captureObservedProcStart` seemed to only make sense for RE-observing an
 * ALREADY-KNOWN pid. That assumption didn't hold up: nothing in that function cares whose pid it's
 * given, it queries the OS by number either way, so `cli/index.ts` calls it on its own
 * `process.pid` right after the worker starts and threads the result down as a plain value
 * (`scheduler/loop.ts#runDaemon`'s own `procStart` parameter) — the same self-description the
 * original text assumed was a real feature to build, when it was already sitting in the existing
 * capture function.
 *
 * **Why this mattered, and which direction of failure it fixes.** Without the tie-break, a PID the
 * OS recycled onto an unrelated process reads as "the daemon is still alive" — a real daemon
 * instance then refuses to start, and NO daemon ends up running while the person believes one is.
 * Compare with the opposite failure (a live daemon read as dead): that spawns a second instance —
 * doubled capture, doubled notification, doubled spend, loud enough that someone notices. The
 * recycled-PID failure is silent, and D-025 exists precisely against absence reading as presence.
 *
 * **The `resolveIsAlive` discipline this reuses, unchanged.** `procStart` that can't be captured or
 * compared (`'unavailable'`) is never read as "dead" — it falls back to plain PID liveness, same as
 * a lock with no recorded `procStart` at all (an older lock file, or a capture that failed at write
 * time). Absence of evidence never becomes license to start a second daemon.
 */

/** What `daemon.lock` records (`adapters/storage/daemon-lock-schema.ts`'s on-disk shape). */
export interface DaemonLockInfo {
  readonly pid: number;
  /** When this lock was written — diagnostic only today (no reader compares it), kept because
   * S4-T5's `seeya daemon --status` will want to say "running since" without a second write. */
  readonly startedAt: Date;
  /**
   * The daemon's own `procStart` at the moment this lock was written (S4-T3b) — the recycled-PID
   * tie-break, same mechanism the Claude Code session registry already uses
   * (`core/classification.ts#pidRepresentsSameProcess`). `undefined` when the platform's capture
   * failed for some reason OTHER than "no daemon" (`ProcStartCapture`'s `unavailable`/`processGone`
   * outcomes) or when the lock was written by an older `seeya` build that never recorded one — in
   * both cases treated as "no tie-break value available", never as "dead" (D-025, same discipline
   * `resolveIsAlive` already applies to a live registry PID whose `procStart` couldn't be read).
   */
  readonly procStart: string | undefined;
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
