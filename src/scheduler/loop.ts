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
import type { DaemonDeps } from './types.js';

/** docs/ESPECIFICACAO.md's own number — never derived from anything else, and never overridable
 * from a config the daemon itself would then have to re-read on every cycle just to know how long
 * to sleep. */
export const POLL_INTERVAL_MS = 30_000;

export interface RunDaemonOptions {
  /** Test-only: stop after this many polls instead of running forever. `undefined` (the real
   * `cli/daemon-command.ts` worker's own default) means "until told to stop". */
  readonly maxIterations?: number;
  /** Checked before every poll and again before every sleep, so a request to stop lands between
   * cycles rather than in the middle of one. `cli/daemon-command.ts` wires this to a POSIX
   * SIGINT/SIGTERM handler; `undefined` (default) never stops on its own. */
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
 * that logs nothing about it — see docs/QUESTOES.md Q-049 for why this doesn't also log anywhere:
 * this project has no diagnostic logger yet, AGENTS.md § "Registro e saída", and the worker's own
 * stdio is `'ignore'` besides, D-005).
 *
 * @example
 * const outcome = await runDaemon(deps, process.pid, {});
 * // outcome.kind === 'alreadyRunning' → another instance already holds the lock; exit non-zero.
 * // otherwise this call never resolves under normal operation (real `POLL_INTERVAL_MS`, no
 * // `shouldStop`) — it's `maxIterations`/`shouldStop` that make it testable at all.
 */
export async function runDaemon(
  deps: DaemonDeps,
  pid: number,
  options: RunDaemonOptions = {},
): Promise<DaemonRunOutcome> {
  const decision = await acquireDaemonLock(
    deps.storage,
    deps.processControl,
    pid,
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
    } catch {
      // Swallowed on purpose — see this function's own docstring.
    }
    if (
      shouldStop() ||
      (options.maxIterations !== undefined && iterations >= options.maxIterations)
    ) {
      break;
    }
    await deps.clock.sleep(POLL_INTERVAL_MS);
  }
  // Best-effort: a real, unclean kill (crash, taskkill, a Windows worker with no console to
  // deliver a signal to at all, D-005) never reaches this line — the NEXT `seeya daemon` start is
  // what notices the stale lock instead (`core/daemon-lock.ts`'s own top comment).
  await deps.storage.clearDaemonLock().catch(() => undefined);
  return { kind: 'stopped' };
}
