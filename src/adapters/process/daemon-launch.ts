/**
 * S4-T3's "sobe desanexado" mechanism (D-005, emended 2026-08-18): re-runs this same `seeya`
 * binary as a detached, console-less child that outlives the shell that ran `seeya daemon`.
 *
 * **`detached: true` + `stdio: 'ignore'` + `.unref()` — all three, not a subset (D-005's own
 * text).** `detached` alone still leaves the child's stdio inherited from the parent's console on
 * Windows, which is enough to keep the child tied to that console's lifetime; `stdio: 'ignore'` is
 * what actually severs it (D-005: "no Windows isso significa console nenhum" —
 * `adapters/process/termination-windows.ts`'s own module comment measures the consequence:
 * `AttachConsole` fails on a process started this way, error 6, `docs/spikes/G-ctrl-break-no-windows.md`).
 * `.unref()` is what lets the LAUNCHER's own event loop drain and exit instead of waiting on a
 * child it will never `wait()` for.
 *
 * `spawn: shell: false` with an argument array throughout (AGENTS.md § "Processos") — the child's
 * own argv never passes through a shell that could mangle a `cwd` with spaces/accents, even though
 * this call has no `cwd`-shaped argument at all (only fixed script args), for the same reason the
 * project bans `exec` everywhere, not just where a variable happens to be dangerous today.
 */
import { spawn } from 'node:child_process';

/** What actually launches the detached worker — `process.execPath` (the same Node binary already
 * running this launcher) plus `scriptPath` (this package's own compiled entry point) and `args`
 * (`['daemon']`, so the child runs the exact same command the human typed). Not `process.argv[1]`
 * directly: that would also carry along whatever OTHER flags the launcher itself was invoked with,
 * which is not what re-running `daemon` specifically means. */
export interface DaemonLaunchTarget {
  readonly scriptPath: string;
  readonly args: readonly string[];
}

/** The one environment variable this project adds when spawning itself as the detached worker —
 * how `cli/daemon-command.ts` tells the child "you are the worker, run the loop" apart from a human
 * typing `seeya daemon` again in a fresh shell. Not a hidden CLI flag: commander has no clean way to
 * hide one option from `--help` while keeping the rest visible, and an env var already carries the
 * same "internal, not for a human to type" signal D-017 uses for the variables `seeya` strips before
 * spawning `claude` — this is the same idiom, pointed the other direction (adding one, not removing
 * several). */
export const DAEMON_CHILD_ENV_VAR = 'SEEYA_DAEMON_CHILD';

/**
 * Spawns `target` detached and unreferenced, and resolves with the child's PID — never waits for it
 * to do anything, since a worker that started successfully runs forever until killed. Rejects only
 * if the OS refuses to spawn the process at all (binary missing, permission denied); a spawn error
 * arriving asynchronously after this resolves (rare, and nothing left to do about it from here) is
 * not this function's problem to catch — the daemon's own lock file staying unwritten is what a
 * later `seeya daemon` invocation's liveness check would notice.
 *
 * `pid` can come back `undefined` per Node's own types (a spawn that fails asynchronously,
 * immediately after this call, before a PID was ever assigned) — treated as a spawn failure here
 * rather than handed to a caller that expects a real PID for the lock file (`core/daemon-lock.ts`).
 */
export function spawnDetachedDaemon(target: DaemonLaunchTarget): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [target.scriptPath, ...target.args], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      env: { ...process.env, [DAEMON_CHILD_ENV_VAR]: '1' },
    });
    child.once('error', reject);
    if (child.pid === undefined) {
      reject(new Error('spawn(seeya daemon worker) did not report a pid'));
      return;
    }
    child.unref();
    resolve(child.pid);
  });
}
