/**
 * `ProcessControl.terminateGracefully` (D-002): ask a process to shut down on its own, wait up to
 * `deadlineMs`, and report whether it actually died — never a forced kill in v1.
 *
 * **Linux/macOS have a real answer: POSIX `SIGTERM`.** A process that installs a handler gets to
 * run it and save its own state before exiting; a process with no handler still gets the default
 * "terminate" action, which is what "graceful, with a deadline" means on these platforms.
 *
 * **Windows has a real answer too — this module used to say otherwise, and that was wrong.**
 * The original text here claimed the mechanism below was structurally impossible: that
 * `GenerateConsoleCtrlEvent` could only broadcast to group 0 (the target's whole console, "the
 * user's whole shell, unacceptable collateral damage") or a specific process group that only
 * exists if the target was launched with `CREATE_NEW_PROCESS_GROUP` — neither under `seeya`'s
 * control. That was reasoning, not measurement, and docs/spikes/G-ctrl-break-no-windows.md
 * measured it wrong: broadcasting `CTRL_BREAK_EVENT` (never `CTRL_C_EVENT` — measured accepted
 * but silently ignored by the target) to a real Claude Code session's console, on two hosts
 * (`cmd.exe` and Git Bash), made it exit through its own shutdown path — it flushed state, left
 * the transcript intact, cleaned up its own session registry entry, and the maintainer confirmed
 * `claude --resume` picks the session back up afterward. A confidently-wrong "impossible" is worse
 * than an outdated comment: it talks the next reader out of trying. See the spike for the full
 * evidence and two interpretation traps it took real effort to get past.
 *
 * **What the spike did *not* prove:** a session with no console at all (`DETACHED_PROCESS`) —
 * `AttachConsole` fails there (error 6), reproduced, and that remains an honest `false` (Q-007).
 * PowerShell itself as the *hosting* console was never tested, only deduced by analogy to
 * `cmd.exe`. And a forced kill is still banned in v1 by D-002, independent of any of this.
 *
 * **The technique, and why the interactive shell surviving isn't the point of it.**
 * `AttachConsole(pid)` + a registered `SetConsoleCtrlHandler` callback + `GenerateConsoleCtrlEvent`,
 * by P/Invoke from PowerShell (`console-signal.ts`) — the same dependency-free technique
 * `adapters/notification/` already uses for the WinRT toast. The event is delivered to the
 * *console*, not to one PID: it goes to every process attached to the target's console, which is
 * why the helper frees its own inherited console before attaching to the target's, and why it
 * registers a handler that swallows the event before generating it — without that, the helper
 * would kill itself first and the target would never see anything (see `console-signal.ts` for
 * why the handler has to be a real callback, not the `SetConsoleCtrlHandler(NULL, TRUE)` "ignore"
 * flag the spike originally described — that flag only covers `CTRL_C_EVENT`, and this event is
 * `CTRL_BREAK_EVENT`). That the user's own interactive shell happened to survive being on the
 * same console (measured on both hosts) is not a feature this design leans on — it's the specific
 * objection that got `GenerateConsoleCtrlEvent` dismissed in the original S1-T2 pass, and
 * measuring it false is what reopened this path. If the day is already over, that terminal
 * closing along with everything else on its console would be no loss either way.
 *
 * **The one console-sharing case that would be this module's problem, not the shell's — and why
 * it's resolved elsewhere.** A long-running `seeya` process could, in principle, end up on the
 * *same* console as a session it's about to terminate (`seeya daemon &` followed by `claude` in
 * the same shell window was the concrete case). The broadcast above would then hit that process
 * too, mid-shutdown of the very session it's trying to close gracefully. **This is resolved by
 * construction, not by a guard here:** D-005 requires the daemon to detach from whatever shell
 * started it — `DETACHED_PROCESS` on Windows, meaning no console at all — precisely so it can
 * never be attached to a session's console in the first place (S4-T3). A process with no console
 * can't receive a console event, the same `AttachConsole` failure this file already treats as
 * `'no-console'`.
 *
 * `terminateGracefullyWindows` still installs a no-op `'SIGBREAK'` listener for the span of the
 * send below — belt and suspenders, not the load-bearing defense. Node maps `CTRL_BREAK_EVENT`
 * onto the `'SIGBREAK'` process event on Windows and terminates the process by default when
 * nothing is listening for it; ignoring it for that one moment is cheap and cannot make anything
 * worse, but the reason a same-console self-hit doesn't happen in practice is D-005, not this
 * listener — don't read this line as the thing that makes the daemon case safe.
 */
import { spawn } from 'node:child_process';
import { errorCode, interpretExistenceCheckError } from './liveness.js';
import { processExists } from './existence.js';
import { sendCtrlBreak, waitForExitWindows } from './console-signal.js';

const POLL_INTERVAL_MS = 100;

/**
 * Blocks, in a single child process, until `pid` disappears or `maxIterations` polls elapse —
 * entirely inside the shell's own `sleep`, never `setTimeout` (D-019 bans that identifier outside
 * `adapters/clock/`, and this wait has nothing to do with "what time is it": it's a bounded
 * courtesy pause while a signal we already sent takes effect, not a scheduling decision). One
 * subprocess handles the whole wait instead of one per poll tick, which keeps this cheap on
 * Windows-hostile-but-N/A-here platforms and avoids relying on any Node timer API at all.
 */
function waitForExit(pid: number, maxIterations: number): Promise<void> {
  const script = `i=0; while kill -0 "$1" 2>/dev/null; do i=$((i+1)); [ "$i" -ge "$2" ] && exit 0; sleep 0.1; done; exit 0`;
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', script, 'sh', String(pid), String(maxIterations)], {
      stdio: 'ignore',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', () => resolve());
  });
}

/**
 * Sends real `SIGTERM` and waits for it to take effect, bounded by `deadlineMs`. Returns whether
 * the process is gone afterward — the wait subprocess is just a courtesy pause; the true/false
 * answer always comes from re-checking reality (`processExists`), never from trusting the wait
 * script's own exit path.
 */
async function terminateGracefullyPosix(pid: number, deadlineMs: number): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ESRCH') {
      return true; // already gone, nothing to terminate
    }
    if (code === 'EPERM') {
      return false; // exists, but we have no permission to signal it — can't terminate
    }
    interpretExistenceCheckError(error); // throws for anything unrecognized
  }
  const maxIterations = Math.max(1, Math.ceil(deadlineMs / POLL_INTERVAL_MS));
  await waitForExit(pid, maxIterations);
  return !(await processExists(pid));
}

/**
 * See the module comment: sends `CTRL_BREAK_EVENT` to `pid`'s console via the PowerShell helper,
 * waits up to `deadlineMs` for it to take effect, and re-checks reality afterward — the same
 * discipline as `terminateGracefullyPosix`, never trusting the helper's own read of "did it work".
 */
async function terminateGracefullyWindows(pid: number, deadlineMs: number): Promise<boolean> {
  if (!(await processExists(pid))) {
    return true; // already gone, nothing to terminate
  }

  // Belt and suspenders, not the load-bearing defense — see the module comment. D-005 (S4-T3)
  // keeps the daemon off any console entirely, which is what actually prevents a self-hit; this
  // listener just means that *if* some other caller of this function ever did share a console
  // with `pid`, it would survive the broadcast it's about to generate instead of dying from it.
  const ignoreSelfSignal = (): void => {};
  process.on('SIGBREAK', ignoreSelfSignal);
  try {
    const outcome = await sendCtrlBreak(pid);
    if (outcome !== 'sent') {
      // 'no-console': AttachConsole failed (error 6) — no console to attach to at all, the one
      // case docs/spikes/G-ctrl-break-no-windows.md left open (Q-007). 'send-failed':
      // GenerateConsoleCtrlEvent itself refused. Both mean the same thing to this caller today —
      // still alive, nothing was sent — kept as distinct `console-signal.ts` outcomes in case a
      // future caller needs to tell them apart.
      return false;
    }
    await waitForExitWindows(pid, deadlineMs);
  } finally {
    process.off('SIGBREAK', ignoreSelfSignal);
  }
  return !(await processExists(pid));
}

export function terminateGracefully(
  pid: number,
  deadlineMs: number,
  platform: string = process.platform,
): Promise<boolean> {
  if (platform === 'win32') {
    return terminateGracefullyWindows(pid, deadlineMs);
  }
  return terminateGracefullyPosix(pid, deadlineMs);
}
