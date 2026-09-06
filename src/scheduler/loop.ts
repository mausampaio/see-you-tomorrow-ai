/**
 * The daemon's own long-running loop (D-005, docs/ESPECIFICACAO.md § "Comportamento do daemon":
 * "loop de verificação a cada 30 s"). `cli/daemon-command.ts` is the only caller, in the DETACHED
 * worker process (D-005: `detached` + `stdio: 'ignore'` + `.unref()`, `adapters/process/daemon-launch.ts`)
 * — this file has no idea it's detached, it just runs `pollOnce` on a cadence until told to stop.
 *
 * **No `node:process` here on purpose.** `pid` and `shouldStop` both arrive as parameters instead
 * of this file reading `process.pid`/registering its own `process.on('SIGINT', ...)` — `cli/` is
 * the composition root (D-020) and the only layer allowed to touch the real environment directly;
 * `scheduler/` receives what it needs already resolved, the same discipline `core/ports.ts#Clock`
 * already applies to `new Date()`.
 */
import { acquireDaemonLock } from './lock.js';
import { pollOnce } from './poll.js';
import { recordPollFailure, recordPollSuccess } from './health.js';
import type { DaemonDeps } from './types.js';

/** docs/ESPECIFICACAO.md's own number — never derived from anything else, and never overridable
 * from a config the daemon itself would then have to re-read on every cycle just to know how long
 * to sleep. */
export const POLL_INTERVAL_MS = 30_000;

/**
 * How often the wait BETWEEN polls rechecks `shouldStop`, in `sleepUntilNextPollOrStop` below —
 * much finer than `POLL_INTERVAL_MS` itself, which still governs how often a POLL happens
 * (unchanged). Added for S4-T5's `seeya daemon --stop`: a real POSIX `SIGTERM` sets `stopRequested`
 * (`cli/daemon-command.ts#runDaemonWorker`) the instant it's delivered, but before this constant
 * existed the loop only ever checked it right after waking from a single, un-chunked 30s sleep —
 * meaning a `--stop` request landing early in that window could sit unnoticed for most of it. This
 * turns "the daemon takes 30s to acknowledge a stop, in the worst case" into "about one second,
 * regardless of when in the window the signal arrives" — a pure responsiveness knob, not a
 * correctness one: an all-healthy daemon that's never asked to stop still sleeps for exactly the
 * same total `POLL_INTERVAL_MS` between polls either way.
 */
const STOP_CHECK_INTERVAL_MS = 1_000;

/**
 * Waits up to `POLL_INTERVAL_MS`, in `STOP_CHECK_INTERVAL_MS`-sized chunks, returning EARLY the
 * moment `shouldStop` reports `true` instead of always waiting out the full interval. `Clock.sleep`
 * is still the only timer this file ever calls (D-019) — this just calls it more than once per
 * poll instead of once, so the wait itself has somewhere to check in.
 */
async function sleepUntilNextPollOrStop(
  clock: DaemonDeps['clock'],
  shouldStop: () => boolean,
): Promise<void> {
  let waited = 0;
  while (waited < POLL_INTERVAL_MS) {
    if (shouldStop()) {
      return;
    }
    const chunk = Math.min(STOP_CHECK_INTERVAL_MS, POLL_INTERVAL_MS - waited);
    await clock.sleep(chunk);
    waited += chunk;
  }
}

export interface RunDaemonOptions {
  /** Test-only: stop after this many polls instead of running forever. `undefined` (the real
   * `cli/daemon-command.ts` worker's own default) means "until told to stop". */
  readonly maxIterations?: number;
  /** Checked before every poll, again right after one finishes, and every `STOP_CHECK_INTERVAL_MS`
   * while waiting for the next one (S4-T5: `sleepUntilNextPollOrStop`) — a request to stop lands
   * within about a second, never in the middle of a poll itself. `cli/daemon-command.ts` wires this
   * to a POSIX SIGINT/SIGTERM handler; `undefined` (default) never stops on its own. */
  readonly shouldStop?: () => boolean;
}

export type DaemonRunOutcome =
  { readonly kind: 'alreadyRunning'; readonly heldByPid: number } | { readonly kind: 'stopped' };

/**
 * Acquires D-005's single-instance lock (with `pid`, the CALLER's own `process.pid` — never read
 * here), then polls every `POLL_INTERVAL_MS` until `options` says to stop. `'alreadyRunning'` means
 * this process never entered the loop at all and never wrote anything — the existing, live daemon
 * is untouched (`core/daemon-lock.ts#decideLockAcquisition`).
 *
 * A single poll throwing NEVER stops the loop (docs/PLANO-DE-ENTREGA.md S4-T3: "o perigo que só
 * existe em laço" — everything tolerable once in a hand-run `seeya end-day` becomes N occurrences
 * in a long-running daemon, and a daemon that dies on the first transient failure is worse than one
 * that vanishes it in silence). **S4-T3b**: the failure no longer just vanishes either — it becomes
 * STATE (`DayState.daemonHealth`, `scheduler/health.ts`), because this project still has nowhere to
 * log it (D-005: worker `stdio` is `'ignore'`; AGENTS.md § "Registro e saída": no inventing a
 * logger mid-task, `docs/QUESTOES.md` Q-049's own item 9).
 *
 * @example
 * const outcome = await runDaemon(deps, process.pid, procStart, {});
 * // outcome.kind === 'alreadyRunning' → another instance already holds the lock; exit non-zero.
 * // otherwise this call never resolves under normal operation (real `POLL_INTERVAL_MS`, no
 * // `shouldStop`) — it's `maxIterations`/`shouldStop` that make it testable at all.
 */
export async function runDaemon(
  deps: DaemonDeps,
  pid: number,
  /**
   * The CALLER's own `procStart` (`cli/index.ts`, captured via
   * `adapters/process/proc-start.ts#captureObservedProcStart` on its own `process.pid`, the same
   * self-description Q-049 item 6 assumed wasn't possible — it always was, nothing in that
   * function cares whose pid it's given) — never derived here, same discipline `pid` itself
   * already gets (this file's own top comment). `undefined` when the platform's capture failed for
   * some other reason: the lock is still written, just without a tie-break value to compare next
   * time (D-025 — no tie-break available is not "no daemon").
   */
  procStart: string | undefined,
  options: RunDaemonOptions = {},
): Promise<DaemonRunOutcome> {
  const decision = await acquireDaemonLock(
    deps.storage,
    deps.processControl,
    pid,
    procStart,
    deps.clock.now(),
  );
  if (decision.kind === 'refuse') {
    return { kind: 'alreadyRunning', heldByPid: decision.heldByPid };
  }

  const shouldStop = options.shouldStop ?? ((): boolean => false);
  let iterations = 0;
  while (options.maxIterations === undefined || iterations < options.maxIterations) {
    if (shouldStop()) {
      break;
    }
    iterations += 1;
    try {
      await pollOnce(deps);
      await recordPollSuccess(deps).catch(() => undefined);
    } catch (error) {
      // The poll itself is still swallowed here — see this function's own docstring — but S4-T3b
      // means it no longer vanishes without a trace: recordPollFailure persists it to
      // DayState.daemonHealth first. Best-effort itself (`.catch`): a failure recording its own
      // failure must never be what actually crashes the loop.
      await recordPollFailure(deps, error).catch(() => undefined);
    }
    if (
      shouldStop() ||
      (options.maxIterations !== undefined && iterations >= options.maxIterations)
    ) {
      break;
    }
    await sleepUntilNextPollOrStop(deps.clock, shouldStop);
  }
  // Best-effort: a real, unclean kill (crash, taskkill, a Windows worker with no console to
  // deliver a signal to at all, D-005) never reaches this line — the NEXT `seeya daemon` start is
  // what notices the stale lock instead (`core/daemon-lock.ts`'s own top comment).
  await deps.storage.clearDaemonLock().catch(() => undefined);
  return { kind: 'stopped' };
}
