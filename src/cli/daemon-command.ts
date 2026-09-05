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
import { checkDaemonLock } from '../scheduler/index.js';
import { runDaemon } from '../scheduler/index.js';
import type { DaemonDeps } from '../scheduler/index.js';
import type { ProcessControl, Storage } from '../core/ports.js';

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
 */
export async function runDaemonWorker(deps: DaemonDeps, pid: number): Promise<number> {
  let stopRequested = false;
  const requestStop = (): void => {
    stopRequested = true;
  };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  try {
    const outcome = await runDaemon(deps, pid, { shouldStop: () => stopRequested });
    return outcome.kind === 'alreadyRunning' ? 1 : 0;
  } finally {
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
  }
}
