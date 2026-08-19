/**
 * Sends `CTRL_BREAK_EVENT` to a Windows console by PID, and waits for a process to leave it, both
 * via a PowerShell helper (P/Invoke into `kernel32.dll`) — no native dependency, same technique
 * `adapters/notification/` already uses for the WinRT toast (docs/spikes/B-notificacoes.md).
 * `src/adapters/process/termination-windows.ts` is the only caller (split out of `termination.ts`
 * in S1-T12); see that file's module comment for what this technique proves and doesn't prove
 * (docs/spikes/G-ctrl-break-no-windows.md).
 *
 * **Why the script is a template literal sent through `-EncodedCommand`, not a `.ps1` file on
 * disk or a `-Command` string.** Two alternatives were considered:
 *
 * - A `.ps1` file in the package needs `tsc`'s build to actually copy it into `dist/` (it won't,
 *   on its own — `tsconfig.build.json` only compiles `.ts`) and a resolved path that survives
 *   being installed from npm, not just run from source. That's two new ways to break silently
 *   after `npm run build` that a `-Command` string doesn't have.
 * - A `-Command <string>` embedded directly needs the script to survive re-quoting once as a
 *   `spawn` argument and, because PowerShell re-parses `-Command`'s value itself, a second time
 *   internally. That is genuinely fragile: building the spike this technique came from, `$_` got
 *   silently swallowed and a backtick was read as command substitution — twice — before the
 *   command worked (docs/spikes/G-ctrl-break-no-windows.md).
 *
 * `-EncodedCommand` sidesteps both: the script text below is never re-parsed as a command line at
 * all, only base64-decoded and run, so nothing in it needs shell-style escaping — and it lives in
 * this file, which `tsc` already compiles into `dist/` like everything else, so there's no second
 * asset to lose track of after a build. The only characters this file has to get right are
 * PowerShell's own (backtick, `@'...'@`), never `cmd.exe`'s or `spawn`'s.
 */
import { spawn } from 'node:child_process';

/** 1 = `CTRL_BREAK_EVENT`. **Never** `CTRL_C_EVENT` (0): measured accepted by the Win32 call but
 * silently ignored by the target — see the table in docs/spikes/G-ctrl-break-no-windows.md § 1. */
const CTRL_BREAK_EVENT = 1;

/** A PID that reached this module already passed `assertValidPid` inside `processExists`
 * (`existence.ts`) at least once, in every real call path. This is a second, cheap check at the
 * boundary of "value about to be spliced into a PowerShell script" specifically — not because the
 * first check is doubted, but because a script built from an unvalidated number is a class of bug
 * this file should refuse to reintroduce even if a future caller skips the existence check. */
function assertSafePid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new RangeError(`pid must be a positive integer, got ${pid}`);
  }
}

const WIN32_P_INVOKE = `
Add-Type -Namespace SeeYa -Name ConsoleSignal -MemberDefinition @'
public delegate bool ConsoleCtrlDelegate(uint CtrlType);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool AttachConsole(uint dwProcessId);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleCtrlHandler(ConsoleCtrlDelegate HandlerRoutine, bool Add);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
'@
`;

/**
 * Builds the script that attaches to `pid`'s console and broadcasts `CTRL_BREAK_EVENT` to it.
 * `pid` is the only value spliced in, and `assertSafePid` guarantees it's a bare positive
 * integer — nothing here ever carries a string an attacker or a weird `cwd` could shape.
 *
 * **`SetConsoleCtrlHandler(NULL, TRUE)` — what docs/spikes/G-ctrl-break-no-windows.md describes
 * as "not optional" for the sender — turned out to be the wrong call for this specific event.**
 * Measured while building this task: with the `NULL`-routine form (documented by Win32 as "the
 * calling process ignores `CTRL_C_EVENT`"), the helper still died the instant it generated
 * `CTRL_BREAK_EVENT` — `NULL,TRUE` only ever covered `CTRL_C_EVENT`, never `CTRL_BREAK_EVENT`, so
 * the helper was broadcasting into its own console with no real protection. A registered
 * **delegate** that returns `$true` for any `CtrlType` is what actually survives it — a real
 * handler, not the "ignore" flag. The spike's warning about needing self-protection stands; this
 * is a correction to *which* API call provides it, discovered because the spike measured against
 * `CTRL_C_EVENT`'s cousin trick, not this exact call, on this exact event.
 */
function buildSendScript(pid: number): string {
  assertSafePid(pid);
  return `
$ErrorActionPreference = 'Stop'
${WIN32_P_INVOKE}
# Detach from whatever console this helper inherited from its Node parent before attaching to
# the target's. Skipping this makes AttachConsole fail outright (ERROR_ACCESS_DENIED) when the
# helper already has one — which it does whenever the caller has a console.
[void][SeeYa.ConsoleSignal]::FreeConsole()

if (-not [SeeYa.ConsoleSignal]::AttachConsole([uint32]${pid})) {
    Write-Output 'no-console'
    exit 0
}

# Without this, the broadcast below would also hit this helper process immediately — it is now
# attached to the target's console too. Must be a real handler delegate, not the
# SetConsoleCtrlHandler(NULL, TRUE) "ignore" flag: that flag only covers CTRL_C_EVENT, not
# CTRL_BREAK_EVENT (measured — see the doc comment above this function). Held in a script-scoped
# variable so the CLR doesn't garbage-collect the delegate before the native side calls through it.
#
# This buys enough time to finish and report below — it does not make this process immune.
# powershell.exe's own console host reacts to CTRL_BREAK_EVENT on its own, separately from this
# handler, and exits shortly after regardless of what the handler returns (see sendCtrlBreak's doc
# comment in console-signal.ts for what that looks like from the Node side and why it's expected).
$handler = [SeeYa.ConsoleSignal+ConsoleCtrlDelegate]{ param($ctrlType) return $true }
if (-not [SeeYa.ConsoleSignal]::SetConsoleCtrlHandler($handler, $true)) {
    Write-Output 'send-failed'
    exit 0
}

if (-not [SeeYa.ConsoleSignal]::GenerateConsoleCtrlEvent(${CTRL_BREAK_EVENT}, 0)) {
    Write-Output 'send-failed'
    exit 0
}

Start-Sleep -Milliseconds 200
Write-Output 'sent'
`;
}

/** Builds the script that blocks until `pid` disappears or `waitMs` elapses — the Windows analog
 * of `termination-posix.ts#waitForExit`'s `sh` loop, since `sh` isn't guaranteed to exist on
 * Windows and D-019 bans `setTimeout`/`setInterval` outside `adapters/clock/` for this kind of
 * bounded pause. */
function buildWaitScript(pid: number, waitMs: number): string {
  assertSafePid(pid);
  const boundedWaitMs = Math.max(0, Math.trunc(waitMs));
  return `
$deadline = [Environment]::TickCount64 + ${boundedWaitMs}
while ([Environment]::TickCount64 -lt $deadline) {
    if (-not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 100
}
`;
}

interface PowerShellRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/**
 * Runs a script through `powershell.exe -EncodedCommand`, `spawn`'d with an argument array and
 * `shell: false` (never a shell-interpolated string). Resolves with stdout, stderr and the exit
 * code — never decides here whether a non-zero exit means failure, because it doesn't always: see
 * `sendCtrlBreak`'s doc comment for a measured case where it doesn't. Only a spawn failure itself
 * (`powershell.exe` missing, permission denied) rejects — that one is unambiguous.
 */
function runPowerShellScript(script: string): Promise<PowerShellRunResult> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encoded];
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
  });
}

/** The three, and only three, ways `buildSendScript` is allowed to finish. Anything else coming
 * back on stdout is a script or parsing defect, and `sendCtrlBreak` throws rather than guess. */
export type CtrlBreakOutcome = 'sent' | 'no-console' | 'send-failed';

const CTRL_BREAK_OUTCOMES: readonly CtrlBreakOutcome[] = ['sent', 'no-console', 'send-failed'];

function isCtrlBreakOutcome(value: string): value is CtrlBreakOutcome {
  return (CTRL_BREAK_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Attaches to `pid`'s console and broadcasts `CTRL_BREAK_EVENT`.
 *
 * `'no-console'` is the honest, expected outcome for a session with no console at all
 * (`DETACHED_PROCESS`) — `AttachConsole` fails with error 6, and there is nothing more this
 * function can do (docs/QUESTOES.md Q-007). `'send-failed'` is kept distinct from `'no-console'`
 * rather than collapsed into it: both currently mean "didn't terminate" to the caller, but they
 * are different failures (attach vs. the actual broadcast), and a future caller may want to tell
 * them apart without this file changing shape again.
 *
 * **Why a non-zero exit code from this particular script is not, by itself, a failure.** Measured
 * while building this task: once the helper attaches to the target's console, `powershell.exe`'s
 * own console host reacts to the very `CTRL_BREAK_EVENT` it just broadcast — independent of, and
 * in addition to, the handler this script registers — by stopping its pipeline and exiting with
 * code 2, *after* the script's own `Write-Output 'sent'` already ran to completion. Reproduced
 * against a target that survives the event too (so this isn't the target's death cascading back),
 * every time, exit 2 with `'sent'` already sitting in stdout. So: a recognized outcome word on
 * stdout is trusted regardless of the exit code (the work it describes already happened); an exit
 * code is only used to explain *why* stdout came back empty or garbled, never to override a
 * successfully parsed outcome.
 */
export async function sendCtrlBreak(pid: number): Promise<CtrlBreakOutcome> {
  const { stdout, stderr, exitCode } = await runPowerShellScript(buildSendScript(pid));
  const outcome = stdout.trim();
  if (isCtrlBreakOutcome(outcome)) {
    return outcome;
  }
  throw new Error(
    `CTRL_BREAK helper script produced no usable outcome (exit ${String(exitCode)}). ` +
      `stdout: ${JSON.stringify(stdout)}. stderr: ${stderr || '(empty)'}`,
  );
}

/**
 * Blocks until `pid` disappears or `waitMs` elapses. Purely a courtesy pause — like the POSIX
 * wait, the caller always re-checks reality afterward instead of trusting this to be conclusive.
 * Unlike `sendCtrlBreak`'s script, this one never attaches to any console, so a non-zero exit here
 * has no equivalent benign explanation — it's a real failure to surface, not to swallow.
 */
export async function waitForExitWindows(pid: number, waitMs: number): Promise<void> {
  const { exitCode, stderr } = await runPowerShellScript(buildWaitScript(pid, waitMs));
  if (exitCode !== 0) {
    throw new Error(
      `wait-for-exit helper exited ${String(exitCode)}, expected 0. stderr: ${stderr || '(empty)'}`,
    );
  }
}
