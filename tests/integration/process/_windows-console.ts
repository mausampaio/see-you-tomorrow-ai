/**
 * Test-only helper: launches a Node script in its **own, brand-new Windows console**, separate
 * from whatever console this test process (`vitest`) itself is attached to.
 *
 * Why this exists at all: `tests/integration/process/termination.test.ts`'s graceful-termination
 * test needs a target process that has a real console for `AttachConsole` to succeed against
 * (docs/spikes/G-ctrl-break-no-windows.md). A plain `spawn()` without `detached` inherits
 * *this* process's console by default on Windows — measured directly while building this task:
 * broadcasting `CTRL_BREAK_EVENT` to that shared console reaches every process attached to it,
 * this test runner included, which is exactly the collateral damage this suite must never risk.
 * `Start-Process` (used below), unlike `spawn`, opens a **new** console window for a console-mode
 * executable by default — precisely the isolation this test needs, so the broadcast this test
 * intentionally sends never has a chance of touching the process running it.
 *
 * Not used for the "no console at all" test — that one wants `DETACHED_PROCESS`, which
 * `spawnDetachedChild` in the test file already gets for free from Node's own `detached: true`
 * on Windows (D-005).
 */
import { spawn } from 'node:child_process';

/** Wraps a value as a single-quoted PowerShell string literal, doubling any embedded `'` — the
 * one escape PowerShell single-quoted strings need. Only ever called with filesystem paths this
 * test generates itself (`mkdtemp` output), never external input. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildStartProcessScript(filePath: string, args: readonly string[]): string {
  const argumentList = args.map(psQuote).join(', ');
  return `
$ErrorActionPreference = 'Stop'
$p = Start-Process -FilePath ${psQuote(filePath)} -ArgumentList @(${argumentList}) -WindowStyle Hidden -PassThru
Write-Output $p.Id
`;
}

/**
 * Launches `node <fixturePath> ...fixtureArgs>` in a new, hidden console and resolves with its
 * PID. The caller is responsible for waiting for the fixture's own readiness signal (this only
 * proves the process was created, not that its signal handlers are registered yet) and for
 * killing the PID afterward — there is no `ChildProcess` handle here to do it automatically,
 * since the process this starts is not `vitest`'s own child in the OS sense.
 */
export function spawnInNewConsole(
  fixturePath: string,
  fixtureArgs: readonly string[],
): Promise<number> {
  const script = buildStartProcessScript(process.execPath, [fixturePath, ...fixtureArgs]);
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
            `Start-Process helper exited ${String(exitCode)}, expected 0. stderr: ${stderr || '(empty)'}`,
          ),
        );
        return;
      }
      const pid = Number.parseInt(stdout.trim(), 10);
      if (!Number.isInteger(pid) || pid <= 0) {
        reject(
          new Error(`Start-Process helper printed a non-PID value: ${JSON.stringify(stdout)}`),
        );
        return;
      }
      resolve(pid);
    });
  });
}
