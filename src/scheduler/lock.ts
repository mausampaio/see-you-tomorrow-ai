/**
 * Wires `core/daemon-lock.ts#decideLockAcquisition` to the real `Storage`/`ProcessControl` ports
 * (D-005's single-instance requirement). Used twice: `cli/daemon-command.ts`'s launcher calls
 * `tryAcquireDaemonLock` once, BEFORE spawning the detached worker, purely to give a human instant
 * feedback ("already running") without spinning up a child that would immediately find itself
 * refused; the worker itself calls it again, with its OWN `process.pid`, as the actual source of
 * truth (`scheduler/loop.ts`) — see that file's own comment for why the check has to be authoritative
 * there and not just in the launcher.
 */
import type { ProcessControl, Storage } from '../core/ports.js';
import { decideLockAcquisition, type LockAcquisitionDecision } from '../core/daemon-lock.js';

/**
 * Reads the current lock (if any), checks its `pid`'s liveness via `ProcessControl`, and decides —
 * never writes anything itself, so a caller that only wants to know ("is one already running?",
 * the launcher's use) doesn't have to also want to acquire.
 *
 * **S4-T3b: passes `existing.procStart` through to `isAlive`, the recycled-PID tie-break.**
 * `ProcessControl.isAlive(pid, procStart)` already does the right thing with either value
 * (`adapters/process/liveness.ts#resolveIsAlive`): a live pid whose CURRENT `procStart` disagrees
 * with the recorded one is a different process wearing an old PID, not the same daemon — `false`.
 * A live pid with no recorded `procStart` at all (an older lock, or a capture that failed at write
 * time) falls back to plain PID liveness — `true`, never treated as "dead" for lack of a
 * comparison (D-025, the exact discipline `resolveIsAlive` already documents for itself).
 */
export async function checkDaemonLock(
  storage: Storage,
  processControl: ProcessControl,
): Promise<LockAcquisitionDecision> {
  const existing = await storage.readDaemonLock();
  const existingIsAlive =
    existing === null ? false : await processControl.isAlive(existing.pid, existing.procStart);
  return decideLockAcquisition(existing, existingIsAlive);
}

/**
 * `checkDaemonLock` plus, only on `'acquire'`, the actual write — `pid`/`procStart`/`now` are all
 * the CALLER's own (the worker's `process.pid`, its own freshly-captured `procStart`, and
 * `Clock.now()`, never re-derived here so this file stays free of `node:process`, `adapters/
 * process/`, and the `Clock` port).
 */
export async function acquireDaemonLock(
  storage: Storage,
  processControl: ProcessControl,
  pid: number,
  procStart: string | undefined,
  now: Date,
): Promise<LockAcquisitionDecision> {
  const decision = await checkDaemonLock(storage, processControl);
  if (decision.kind === 'acquire') {
    await storage.writeDaemonLock({ pid, startedAt: now, procStart });
  }
  return decision;
}
