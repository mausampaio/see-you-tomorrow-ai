/**
 * Sends `CTRL_BREAK_EVENT` to a Windows console by PID, and waits for a process to leave it, both
 * via a PowerShell helper (P/Invoke into `kernel32.dll`) — no native dependency, same technique
 * `adapters/notification/` already uses for the WinRT toast (docs/spikes/B-notificacoes.md).
 * `docs/adapters/process/termination.ts` is the only caller; see that file's module comment for
 * what this technique proves and doesn't prove (docs/spikes/G-ctrl-break-no-windows.md).
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
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool AttachConsole(uint dwProcessId);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleCtrlHandler(IntPtr HandlerRoutine, bool Add);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
'@
`;

/**
 * Builds the script that attaches to `pid`'s console and broadcasts `CTRL_BREAK_EVENT` to it.
 * `pid` is the only value spliced in, and `assertSafePid` guarantees it's a bare positive
 * integer — nothing here ever carries a string an attacker or a weird `cwd` could shape.
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

# Without this, the broadcast below would also hit this helper process — it is now attached to
# the target's console too — and could kill it before the event ever reaches the target.
[void][SeeYa.ConsoleSignal]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)

if (-not [SeeYa.ConsoleSignal]::GenerateConsoleCtrlEvent(${CTRL_BREAK_EVENT}, 0)) {
    Write-Output 'send-failed'
    exit 0
}

Write-Output 'sent'
`;
}

/** Builds the script that blocks until `pid` disappears or `waitMs` elapses — the Windows analog
 * of `termination.ts#waitForExit`'s `sh` loop, since `sh` isn't guaranteed to exist on Windows and
 * D-019 bans `setTimeout`/`setInterval` outside `adapters/clock/` for this kind of bounded pause. */
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

/**
 * Runs a script through `powershell.exe -EncodedCommand`, `spawn`'d with an argument array and
 * `shell: false` (never a shell-interpolated string). Resolves with combined stdout; rejects on
 * spawn failure or a non-zero exit — both are "couldn't verify", never folded into a discreet
 * `false` (see termination.ts's module comment and D-025).
 */
function runPowerShellScript(script: string): Promise<string> {
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
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(
          new Error(
            `powershell.exe exited ${String(exitCode)}, expected 0. stderr: ${stderr || '(empty)'}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
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
 */
export async function sendCtrlBreak(pid: number): Promise<CtrlBreakOutcome> {
  const stdout = await runPowerShellScript(buildSendScript(pid));
  const outcome = stdout.trim();
  if (!isCtrlBreakOutcome(outcome)) {
    throw new Error(
      `unexpected output from the CTRL_BREAK helper script: ${JSON.stringify(stdout)}`,
    );
  }
  return outcome;
}

/** Blocks until `pid` disappears or `waitMs` elapses. Purely a courtesy pause — like the POSIX
 * wait, the caller always re-checks reality afterward instead of trusting this to be conclusive. */
export async function waitForExitWindows(pid: number, waitMs: number): Promise<void> {
  await runPowerShellScript(buildWaitScript(pid, waitMs));
}
