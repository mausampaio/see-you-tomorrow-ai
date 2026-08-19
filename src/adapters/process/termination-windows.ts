/**
 * Windows half of `ProcessControl.terminateGracefully` (D-002). See `termination.ts` for the
 * dispatcher and the general contract ("wait up to `deadlineMs`, report whether it actually died,
 * never a forced kill in v1").
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
 *
 * **Windows-only by construction (S1-T12), the same shape as `console-signal.ts`.**
 * `termination.ts`'s dispatcher never calls into this file when `process.platform !== 'win32'`, so
 * every line here is structurally unreachable on a Linux/macOS coverage run. `vitest.config.ts`
 * excludes this file from that denominator (`WINDOWS_ONLY_SOURCE`) for the same reason it already
 * excluded `console-signal.ts`.
 */
import { processExists } from './existence.js';
import { sendCtrlBreak, waitForExitWindows } from './console-signal.js';

/**
 * See the module comment: sends `CTRL_BREAK_EVENT` to `pid`'s console via the PowerShell helper,
 * waits up to `deadlineMs` for it to take effect, and re-checks reality afterward — the same
 * discipline as `terminateGracefullyPosix`, never trusting the helper's own read of "did it work".
 */
export async function terminateGracefullyWindows(
  pid: number,
  deadlineMs: number,
): Promise<boolean> {
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
