/**
 * `seeya daemon` (docs/ESPECIFICACAO.md § `seeya daemon`, D-005). Two modes, chosen by
 * `adapters/process/daemon-launch.ts#DAEMON_CHILD_ENV_VAR` — set only on the detached child's own
 * environment, never something a human types:
 *
 * - **Launcher** (`runDaemonLauncher`, the human's own invocation): checks the lock, and either
 *   refuses with a clear message or spawns the detached worker and returns immediately — this
 *   process's own console is the only place any of this is ever printed (D-005's "custo assumido":
 *   the worker itself has none).
 * - **Worker** (`runDaemonWorker`, the detached child): the actual long-running loop
 *   (`scheduler/loop.ts#runDaemon`), until a POSIX signal asks it to stop or `decideLockAcquisition`
 *   refuses outright (another instance won the race).
 */
import { spawnDetachedDaemon, type DaemonLaunchTarget } from '../adapters/process/daemon-launch.js';
import { terminateAbruptly } from '../adapters/process/termination.js';
import { checkDaemonLock, buildDaemonUnhealthyNotice } from '../scheduler/index.js';
import { runDaemon } from '../scheduler/index.js';
import type { DaemonDeps } from '../scheduler/index.js';
import type { Clock, ProcessControl, Storage } from '../core/ports.js';
import type { DaemonLockInfo } from '../core/daemon-lock.js';
import type { DaemonHealth, DayState } from '../core/types.js';
import { localDayString } from '../core/day.js';
import {
  decideSchedule,
  emptyDayState,
  resetIfNewDay,
  type ScheduleDecision,
} from '../core/schedule.js';

/**
 * Pre-flight only — `scheduler/lock.ts#checkDaemonLock` never writes. Refusing here BEFORE
 * spawning saves the cost of a child that would immediately find itself refused anyway (the
 * worker's own `runDaemon` call is the authoritative check; see that file's module comment for
 * why both exist).
 */
export async function runDaemonLauncher(
  storage: Storage,
  processControl: ProcessControl,
  target: DaemonLaunchTarget,
): Promise<string> {
  const decision = await checkDaemonLock(storage, processControl);
  if (decision.kind === 'refuse') {
    return `seeya daemon is already running (pid ${decision.heldByPid}). Nothing started.`;
  }
  const pid = await spawnDetachedDaemon(target);
  return (
    `seeya daemon started (pid ${pid}), detached from this terminal — closing this window or ` +
    'logging out will not stop it.'
  );
}

/**
 * The worker's own entry point — never resolves under normal operation except when
 * `decideLockAcquisition` refuses (another instance already won) or a POSIX SIGINT/SIGTERM asks it
 * to stop. Returns an exit code rather than calling `process.exit` itself, so `cli/index.ts` stays
 * the one place that decides `process.exitCode` (same convention `start-day-command`'s own caller
 * already follows).
 *
 * **Signal handling lives here, not in `scheduler/loop.ts`.** `scheduler/` cannot touch
 * `node:process` directly (D-020: `cli/` is the only composition root allowed to name a concrete
 * environment API) — this function registers the handlers and hands `runDaemon` a plain
 * `shouldStop` closure instead.
 *
 * **`procStart` is a plain value, not captured here (S4-T3b).** `cli/index.ts` — the actual entry
 * point, one level up — captures it once via `adapters/process/proc-start.ts` and passes it down,
 * the same discipline `pid` itself already gets from `runDaemon`'s own docstring: this function has
 * no real-I/O concern of its own to keep pure for its unit tests (`tests/unit/cli/daemon-command.test.ts`
 * passes `undefined` and never touches a real process for it).
 */
export async function runDaemonWorker(
  deps: DaemonDeps,
  pid: number,
  procStart: string | undefined,
): Promise<number> {
  let stopRequested = false;
  const requestStop = (): void => {
    stopRequested = true;
  };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  try {
    const outcome = await runDaemon(deps, pid, procStart, { shouldStop: () => stopRequested });
    return outcome.kind === 'alreadyRunning' ? 1 : 0;
  } finally {
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
  }
}

// ---------------------------------------------------------------------------------------------
// S4-T5: `seeya daemon --stop`/`--status` — the natural consumer of S4-T3b's lock `procStart`
// tie-break and `DayState.daemonHealth`. Both commands share one read of "is the recorded lock's
// pid actually alive" (`checkLiveLock` below), so `--status` and `--stop` can never disagree about
// which of the four states (D-024) they're looking at.
// ---------------------------------------------------------------------------------------------

export interface DaemonControlDeps {
  readonly storage: Storage;
  readonly processControl: ProcessControl;
  readonly clock: Clock;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The four states D-024 says must never flatten into "does a lock file exist":
 * - `noLock` — never started, or a clean shutdown already cleared it.
 * - `dead` — a lock exists, but `ProcessControl.isAlive` (S4-T3b's own recycled-pid tie-break,
 *   `lock.procStart` passed straight through) says its pid is gone. Also "not running", worded
 *   differently so a stale file left by a crash never reads as something currently wrong.
 * - `alive` — a lock exists and its pid is confirmed alive.
 * - `unknown` — the liveness check itself THREW (`adapters/process/liveness.ts#
 *   interpretExistenceCheckError` refuses to guess on an unrecognized OS error) — neither "running"
 *   nor "not running" is something this command actually knows (D-025), so neither is claimed.
 */
type LiveLockCheck =
  | { readonly kind: 'noLock' }
  | { readonly kind: 'dead'; readonly lock: DaemonLockInfo }
  | { readonly kind: 'alive'; readonly lock: DaemonLockInfo }
  | { readonly kind: 'unknown'; readonly lock: DaemonLockInfo; readonly error: string };

async function checkLiveLock(deps: DaemonControlDeps): Promise<LiveLockCheck> {
  const lock = await deps.storage.readDaemonLock();
  if (lock === null) {
    return { kind: 'noLock' };
  }
  try {
    const alive = await deps.processControl.isAlive(lock.pid, lock.procStart);
    return alive ? { kind: 'alive', lock } : { kind: 'dead', lock };
  } catch (error) {
    return { kind: 'unknown', lock, error: describeError(error) };
  }
}

function describeLiveness(check: LiveLockCheck): string {
  switch (check.kind) {
    case 'noLock':
      return 'Daemon: not running.';
    case 'dead':
      return (
        `Daemon: not running (a stale lock file for pid ${check.lock.pid} was found; the next ` +
        '"seeya daemon" reclaims it automatically).'
      );
    case 'unknown':
      return (
        `Daemon: found a lock file for pid ${check.lock.pid}, but could not verify whether it ` +
        `is still alive (${check.error}).`
      );
    case 'alive':
      return `Daemon: running (pid ${check.lock.pid}, started ${check.lock.startedAt.toISOString()}).`;
  }
}

/**
 * Mirrors `cli/snooze-command.ts#renderSnoozeConfirmation`'s own discipline: render
 * `decideSchedule`'s ACTUAL decision, never a hand-rolled re-check of `skipped`/`endOfDayFired`, so
 * this can never disagree with what the next real poll would do with the same state. Covers every
 * `ScheduleDecision` variant by name (D-024) — the brief's "horário efetivo de hoje", "se o dia foi
 * pulado" and "se o encerramento já disparou" fall directly out of which variant this is.
 */
function describeScheduleDecision(decision: ScheduleDecision, state: DayState): string[] {
  const pad2 = (value: number): string => String(value).padStart(2, '0');
  const localTime = (instant: Date): string =>
    `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}`;
  const lines: string[] = [];
  switch (decision.kind) {
    case 'disabled':
      return ['End-of-day: not configured (manual only).'];
    case 'skipped':
      return ['End-of-day: skipped today (seeya skip-today) — will resume tomorrow.'];
    case 'alreadyEnded':
      lines.push(
        `End-of-day: already ran today (effective ${localTime(decision.effectiveEndOfDay)}).`,
      );
      break;
    case 'waiting':
      lines.push(
        `End-of-day: scheduled for ${localTime(decision.effectiveEndOfDay)}, not reached yet.`,
      );
      break;
    case 'leadTimeWarning':
      lines.push(
        `End-of-day: closing in about ${decision.leadTimeMinutes} minute(s), at ` +
          `${localTime(decision.effectiveEndOfDay)}.`,
      );
      break;
    case 'endOfDay':
      lines.push(
        `End-of-day: due now (${localTime(decision.effectiveEndOfDay)}, about ` +
          `${Math.round(decision.delayMs / 60_000)} minute(s) past) — the next poll acts on this.`,
      );
      break;
  }
  if (state.snoozeMinutesTotal > 0) {
    lines.push(`Snoozed today: ${state.snoozeMinutesTotal} minute(s) total.`);
  }
  return lines;
}

/**
 * `health` is read straight from `estado.json` regardless of whether the daemon is CURRENTLY
 * alive — it can genuinely be stale (the daemon failed for hours, then was stopped or crashed) —
 * so the wording is tensed by `aliveness` instead of always claiming the present ("has failed
 * every poll... and hasn't completed a cycle SINCE" would be false once nothing is running at
 * all). Reuses `scheduler/notices.ts#buildDaemonUnhealthyNotice`'s own estimate/wording instead of
 * recomputing the minutes-from-cycle-count arithmetic a second time (AGENTS.md: "nada de
 * duplicação") — the number a person was already notified with and the number `--status` shows
 * must never be able to disagree.
 */
function describeHealth(health: DaemonHealth, aliveness: LiveLockCheck['kind']): string {
  if (health.consecutiveCycleFailures === 0) {
    return aliveness === 'alive'
      ? 'Daemon health: healthy — no failed cycles recorded.'
      : 'Daemon health: no failed cycles recorded (as of the last time it ran, if ever).';
  }
  const detail = buildDaemonUnhealthyNotice(health).body;
  if (aliveness === 'alive') {
    return `Daemon health: ${detail}`;
  }
  if (aliveness === 'unknown') {
    return `Daemon health (last recorded; current process status unknown): ${detail}`;
  }
  return `Daemon health (as of its last recorded cycle, before it stopped): ${detail}`;
}

/**
 * `seeya daemon --status` — read-only (never writes `daemon.lock` or `estado.json`, even when it
 * notices a stale lock: that cleanup is `runDaemonStop`'s job, only when the user asked to stop
 * something). The consumer S4-T3b built `DayState.daemonHealth` and the lock's `procStart`
 * tie-break FOR (docs/PLANO-DE-ENTREGA.md S4-T3b's own words: "this is where it pays off").
 */
export async function runDaemonStatus(deps: DaemonControlDeps): Promise<string> {
  const check = await checkLiveLock(deps);
  const config = await deps.storage.readConfig();
  const now = deps.clock.now();
  const today = localDayString(now);
  const persisted = resetIfNewDay((await deps.storage.readState()) ?? emptyDayState(today), today);
  const { decision } = decideSchedule(config, persisted, now);

  return [
    describeLiveness(check),
    ...describeScheduleDecision(decision, persisted),
    describeHealth(persisted.daemonHealth, check.kind),
  ].join('\n');
}

/**
 * Real `SIGTERM` might not be noticed until the daemon wakes from its own wait between polls —
 * `scheduler/loop.ts#sleepUntilNextPollOrStop` (S4-T5) rechecks every ~1s, not just once per
 * `POLL_INTERVAL_MS`, so this deadline only needs slack for that plus one in-flight poll's own I/O,
 * not the full 30s a single un-chunked sleep would have needed.
 */
const GRACEFUL_STOP_DEADLINE_MS = 15_000;

/** `SIGKILL`/`TerminateProcess` are both uncatchable and normally near-instant — this is just
 * enough slack for the OS to finish tearing the process down before re-checking reality. */
const ABRUPT_STOP_CONFIRM_MS = 2_000;

async function waitUntilDead(
  clock: Clock,
  processControl: ProcessControl,
  pid: number,
  boundMs: number,
): Promise<void> {
  const pollIntervalMs = 200;
  for (let waited = 0; waited < boundMs; waited += pollIntervalMs) {
    if (!(await processControl.isAlive(pid))) {
      return;
    }
    await clock.sleep(pollIntervalMs);
  }
}

/**
 * Sends `terminateAbruptly`, waits briefly, and reports whether `pid` is confirmed dead
 * afterward — never throws itself (a permission error is reported in the caller's own message,
 * not an uncaught rejection reaching `cli/index.ts`'s top-level catch, AGENTS.md § "Mensagens de
 * erro").
 */
async function attemptAbruptStop(
  deps: DaemonControlDeps,
  pid: number,
): Promise<{ readonly dead: boolean; readonly sendError: string | null }> {
  try {
    await terminateAbruptly(pid);
  } catch (error) {
    return { dead: false, sendError: describeError(error) };
  }
  await waitUntilDead(deps.clock, deps.processControl, pid, ABRUPT_STOP_CONFIRM_MS);
  const stillAlive = await deps.processControl.isAlive(pid);
  return { dead: !stillAlive, sendError: null };
}

/**
 * The lock is cleared exactly when there is POSITIVE evidence `pid` is dead — never on a mere
 * "the kill was sent" assumption (D-025). If the forced stop couldn't even be sent, or the pid is
 * still observed alive afterward, the lock is left in place: a stray lock that blocks the next
 * `seeya daemon` is annoying but safe (`--stop`/`--status` still work, and it's recoverable by
 * hand); silently clearing a lock whose pid might still be running risks a live SECOND daemon
 * starting alongside it, which the whole rest of D-005 exists to prevent.
 */
async function finishAbruptStop(
  deps: DaemonControlDeps,
  pid: number,
  reasonSuffix: string,
): Promise<string> {
  const { dead, sendError } = await attemptAbruptStop(deps, pid);
  if (sendError !== null) {
    return `Could not send a forced stop to pid ${pid}: ${sendError}. Nothing was cleared — check manually.`;
  }
  if (!dead) {
    return (
      `Sent a forced stop to pid ${pid}, but it still appears to be alive ` +
      `${ABRUPT_STOP_CONFIRM_MS / 1000}s later. The lock was left in place — check manually ` +
      '(e.g. tasklist/ps) before retrying.'
    );
  }
  await deps.storage.clearDaemonLock().catch(() => undefined);
  return `Stopped the daemon (pid ${pid}) — ${reasonSuffix}.`;
}

/**
 * Windows has no graceful mechanism that reaches this process at all: it runs detached with no
 * console (D-005), so `CTRL_BREAK_EVENT` can never be delivered (`AttachConsole` fails with error 6
 * — docs/spikes/G-ctrl-break-no-windows.md's own "what was not proven": a console-less target), and
 * a cross-process `SIGTERM` there calls `TerminateProcess` immediately without ever running the
 * target's own JS handler (measured building S4-T3b, `tests/integration/process/
 * daemon-launch.test.ts`'s own comment on that exact call). There is nothing graceful to try first,
 * so this does not pretend symmetry with the POSIX path below by attempting one anyway.
 */
const WINDOWS_ABRUPT_REASON =
  'stopped abruptly: Windows has no way to ask a console-less, detached process (D-005) to shut ' +
  'down on its own, and a cross-process signal there terminates immediately without running its ' +
  'own shutdown code';

/**
 * `seeya daemon --stop`. `platform` defaults to `process.platform`, injectable for tests — same
 * convention `adapters/process/termination.ts#terminateGracefully` already uses.
 *
 * **Who clears the lock, and why it's always this function, never the daemon's own exit path
 * alone (the brief's own "quem limpa" question).** The daemon DOES still clear its own lock on a
 * clean stop (`scheduler/loop.ts#runDaemon`'s own best-effort `clearDaemonLock()`), and that stays
 * valuable defense-in-depth for a stop this command never triggered (someone else's bare `kill
 * -TERM`, a Ctrl+C reaching an attached shell). But `--stop` never RELIES on that alone, because it
 * provably cannot on Windows (no graceful path exists there at all, `WINDOWS_ABRUPT_REASON` above)
 * and is not guaranteed on POSIX either (a crash between the signal and the daemon's own cleanup
 * write). This function always confirms death itself before declaring success, and always clears
 * the lock itself once it has that confirmation — covering exactly the case the brief names: "o
 * processo morre sem limpar".
 */
export async function runDaemonStop(
  deps: DaemonControlDeps,
  platform: string = process.platform,
): Promise<string> {
  const check = await checkLiveLock(deps);
  if (check.kind === 'noLock') {
    return 'No daemon is running. Nothing to stop.';
  }
  if (check.kind === 'unknown') {
    return (
      `Found a daemon lock for pid ${check.lock.pid}, but could not verify whether it is still ` +
      `alive (${check.error}). Nothing was stopped — check manually before retrying.`
    );
  }
  if (check.kind === 'dead') {
    await deps.storage.clearDaemonLock().catch(() => undefined);
    return (
      `No daemon is running (pid ${check.lock.pid} from the lock file is no longer alive; the ` +
      'stale lock was cleared).'
    );
  }

  // check.kind === 'alive' from here — an actual live daemon to stop.
  if (platform === 'win32') {
    return finishAbruptStop(deps, check.lock.pid, WINDOWS_ABRUPT_REASON);
  }
  const stoppedGracefully = await deps.processControl.terminateGracefully(
    check.lock.pid,
    GRACEFUL_STOP_DEADLINE_MS,
  );
  if (stoppedGracefully) {
    await deps.storage.clearDaemonLock().catch(() => undefined);
    return `Stopped the daemon (pid ${check.lock.pid}) gracefully.`;
  }
  return finishAbruptStop(
    deps,
    check.lock.pid,
    `did not exit within ${Math.round(GRACEFUL_STOP_DEADLINE_MS / 1000)}s of a graceful SIGTERM, ` +
      'so it was stopped forcibly instead',
  );
}
