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
import { checkDaemonLock } from '../scheduler/index.js';
import { runDaemon } from '../scheduler/index.js';
import type { DaemonDeps } from '../scheduler/index.js';
import type { Clock, ProcessControl, Storage } from '../core/ports.js';
import {
  checkLiveLock,
  describeDaemonState,
  describeError,
  type DaemonStateDeps,
} from './daemon-state.js';

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
// pid actually alive" (`checkLiveLock`, `./daemon-state.js`), so `--status` and `--stop` can never
// disagree about which of the four states (D-024) they're looking at.
//
// **S4-T13 moved `checkLiveLock`/`describeLiveness`/`describeScheduleDecision`/`describeHealth`/
// `describeDaemonState` out to `./daemon-state.ts`.** `seeya status` needs the exact same daemon
// report `--status` renders (docs/PLANO-DE-ENTREGA.md S4-T13, cuidado (a): "extraia o que for
// compartilhado em vez de copiar texto") — this file re-exports `DaemonControlDeps` as the same
// type `daemon-state.ts` calls `DaemonStateDeps`, so every existing caller/test of this module
// keeps working unchanged.
// ---------------------------------------------------------------------------------------------

export type DaemonControlDeps = DaemonStateDeps;

/**
 * `seeya daemon --status` — read-only (never writes `daemon.lock` or `estado.json`, even when it
 * notices a stale lock: that cleanup is `runDaemonStop`'s job, only when the user asked to stop
 * something). The consumer S4-T3b built `DayState.daemonHealth` and the lock's `procStart`
 * tie-break FOR (docs/PLANO-DE-ENTREGA.md S4-T3b's own words: "this is where it pays off").
 *
 * **S4-T13: a thin wrapper around `./daemon-state.ts#describeDaemonState`.** `seeya status` calls
 * that same function directly — this is what makes the two commands' daemon section structurally
 * unable to disagree (`tests/unit/cli/daemon-status-agreement.test.ts`).
 */
export async function runDaemonStatus(deps: DaemonControlDeps): Promise<string> {
  return describeDaemonState(deps);
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
 * S4-T8 item 2. Answers the two things whoever typed `--stop` actually wants to know — "did it
 * really stop" and "did I lose anything" — instead of the mechanism of HOW it stopped. Verified,
 * not assumed (the brief's own "confira antes de escrever"): `scheduler/poll.ts#pollOnce` re-reads
 * `Config`/`DayState` from `Storage` at the top of every cycle and writes back whatever it decided
 * (`handleLeadTimeWarning`'s `saveState`, `runEndOfDay`'s `saveState`, the day-rollover `saveState`)
 * BEFORE that cycle returns — `scheduler/loop.ts#runDaemon` never holds a decision only in memory
 * across two poll iterations. So a stop landing between polls loses nothing, by construction: the
 * next `seeya daemon` starts from the exact same `estado.json` this one would have. The one thing
 * this sentence does NOT cover is a stop landing INSIDE an in-flight poll (e.g. mid-capture) that
 * gets killed before that poll's own `saveState` runs — nothing is corrupted then either (the write
 * simply never happened), but that specific capture attempt is not counted
 * (`core/capture-retry.ts#recordCaptureAttempts` only runs after `endDay` resolves) and is retried
 * by the next daemon rather than skipped, which is the honest reading of "nothing was lost": at
 * worst something in progress restarts, nothing already decided disappears.
 */
const DAEMON_STOP_NOTHING_LOST =
  'Nothing was lost: it saves its state after every poll cycle, so the next "seeya daemon" picks ' +
  'up exactly where this one left off.';

/**
 * The lock is cleared exactly when there is POSITIVE evidence `pid` is dead — never on a mere
 * "the kill was sent" assumption (D-025). If the forced stop couldn't even be sent, or the pid is
 * still observed alive afterward, the lock is left in place: a stray lock that blocks the next
 * `seeya daemon` is annoying but safe (`--stop`/`--status` still work, and it's recoverable by
 * hand); silently clearing a lock whose pid might still be running risks a live SECOND daemon
 * starting alongside it, which the whole rest of D-005 exists to prevent.
 */
async function finishAbruptStop(deps: DaemonControlDeps, pid: number): Promise<string> {
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
  return `Stopped the daemon (pid ${pid}) forcibly. ${DAEMON_STOP_NOTHING_LOST}`;
}

/**
 * `seeya daemon --stop`. `platform` defaults to `process.platform`, injectable for tests — same
 * convention `adapters/process/termination.ts#terminateGracefully` already uses.
 *
 * **Who clears the lock, and why it's always this function, never the daemon's own exit path
 * alone (the brief's own "quem limpa" question).** The daemon DOES still clear its own lock on a
 * clean stop (`scheduler/loop.ts#runDaemon`'s own best-effort `clearDaemonLock()`), and that stays
 * valuable defense-in-depth for a stop this command never triggered (someone else's bare `kill
 * -TERM`, a Ctrl+C reaching an attached shell). But `--stop` never RELIES on that alone, because it
 * provably cannot on Windows (no graceful path exists there at all — see the comment on the
 * `platform === 'win32'` branch below) and is not guaranteed on POSIX either (a crash between the
 * signal and the daemon's own cleanup write). This function always confirms death itself before
 * declaring success, and always clears the lock itself once it has that confirmation — covering
 * exactly the case the brief names: "o processo morre sem limpar".
 *
 * **S4-T8 item 2, cuidado (d): the on-screen text no longer explains the Windows mechanism.** That
 * explanation is real and stays valuable — it just moved to the comment on the branch below, where
 * a future maintainer reads it. Whoever typed `--stop` gets `DAEMON_STOP_NOTHING_LOST`'s answer to
 * the two questions that actually matter, not a paragraph on `AttachConsole`/`TerminateProcess`.
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
  //
  // Windows has no graceful mechanism that reaches this process at all: it runs detached with no
  // console (D-005), so `CTRL_BREAK_EVENT` can never be delivered (`AttachConsole` fails with
  // error 6 — docs/spikes/G-ctrl-break-no-windows.md's own "what was not proven": a console-less
  // target), and a cross-process `SIGTERM` there calls `TerminateProcess` immediately without ever
  // running the target's own JS handler (measured building S4-T3b, `tests/integration/process/
  // daemon-launch.test.ts`'s own comment on that exact call). There is nothing graceful to try
  // first, so this does not pretend symmetry with the POSIX path below by attempting one anyway.
  if (platform === 'win32') {
    return finishAbruptStop(deps, check.lock.pid);
  }
  const stoppedGracefully = await deps.processControl.terminateGracefully(
    check.lock.pid,
    GRACEFUL_STOP_DEADLINE_MS,
  );
  if (stoppedGracefully) {
    await deps.storage.clearDaemonLock().catch(() => undefined);
    return `Stopped the daemon (pid ${check.lock.pid}) gracefully. ${DAEMON_STOP_NOTHING_LOST}`;
  }
  // Did not exit within GRACEFUL_STOP_DEADLINE_MS of the SIGTERM above — escalate to the same
  // forced path Windows always takes. Why a graceful signal alone isn't sufficient here belongs in
  // `attemptAbruptStop`'s own docstring, not on this screen either.
  return finishAbruptStop(deps, check.lock.pid);
}
