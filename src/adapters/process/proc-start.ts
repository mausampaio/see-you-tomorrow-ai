/**
 * Captures the OS's current `procStart` for a PID — the value compared against the one recorded
 * at discovery time to break a recycled-PID tie (D-016, `core/classification.ts`).
 *
 * The three platforms don't just format the value differently, they get it from a different place
 * entirely (docs/spikes/F-procstart-por-so.md, independently confirmed — see the module-level
 * comments below for what was re-verified and how):
 *
 * | Platform | Source                              | Shape                              |
 * |----------|-------------------------------------|-------------------------------------|
 * | Linux    | `/proc/<pid>/stat`, field 22         | digits, ticks since boot            |
 * | macOS    | `ps -o lstart= -p <pid>`             | human-readable date, `LC_ALL=C`/`TZ=UTC` |
 * | Windows  | `(Get-Process -Id <pid>).StartTime`  | digits, Windows FILETIME (100ns since 1601) |
 *
 * The two "digits" shapes (Linux, Windows) are on completely different scales and never compare
 * across platforms — that's expected and fine, because `pidRepresentsSameProcess` only ever
 * compares two readings taken on the *same* machine.
 *
 * Every function here disambiguates a failure into `processGone` or `unavailable` (see
 * `ProcStartCapture` in `liveness.ts`) by re-running the same existence check `isAlive` already
 * uses, rather than trying to parse each OS command's specific error text (which is not a
 * contract any of these tools publish). If the PID is confirmed gone by that check, the earlier
 * failure was the race of the process dying between the liveness check and this read; if the PID
 * is still there, the failure is something else and D-025 applies — "unavailable", not "false".
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { ProcStartCapture } from './liveness.js';

type ExistenceRecheck = (pid: number) => Promise<boolean>;

function afterFailure(pid: number, reason: string, recheck: ExistenceRecheck) {
  return recheck(pid).then((stillExists): ProcStartCapture => {
    if (!stillExists) {
      return { kind: 'processGone' };
    }
    return { kind: 'unavailable', reason };
  });
}

/**
 * Linux: `/proc/<pid>/stat` field 22 (`starttime`), ticks since boot.
 *
 * **Field 2 (`comm`, the executable name in parentheses) can itself contain a space and a closing
 * paren** — confirmed independently here by executing a binary renamed to `weird (name) here`
 * inside a `node:22-bookworm` container: the kernel truncates `comm` to 15 bytes but keeps the
 * parenthesis, producing a stat line like `10 (weird (name) he) S 1 1 ...`. Splitting on the
 * *first* `)` reads field 22 as `"1"` (garbage, actually part of `comm`'s own tokens); splitting
 * on the *last* `)` — `lastIndexOf(')')`, matching the vendor's own parser per the spike — reads
 * the correct starttime. This is exactly the case docs/spikes/F-procstart-por-so.md flagged as
 * "custa caro se ignorado", and it reproduces the way the spike said it would.
 */
export function parseLinuxProcStat(statLine: string): string | undefined {
  const closingParen = statLine.lastIndexOf(')');
  if (closingParen === -1) {
    return undefined;
  }
  // Skip ") " to reach field 3 (state); starttime is field 22, i.e. index 19 among fields 3..N.
  const fieldsAfterComm = statLine.slice(closingParen + 2).split(' ');
  return fieldsAfterComm[19];
}

async function captureLinux(pid: number, recheck: ExistenceRecheck): Promise<ProcStartCapture> {
  let statLine: string;
  try {
    statLine = await readFile(`/proc/${pid}/stat`, 'utf8');
  } catch (error) {
    return afterFailure(pid, `reading /proc/${pid}/stat failed: ${String(error)}`, recheck);
  }
  const value = parseLinuxProcStat(statLine);
  if (value === undefined) {
    return afterFailure(
      pid,
      `/proc/${pid}/stat did not have the expected shape: "${statLine}"`,
      recheck,
    );
  }
  return { kind: 'value', value };
}

/** Runs `command` with `args`, returning trimmed stdout, or `undefined` on any failure. */
function runForStdout(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], shell: false, env });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => resolve(code === 0 ? stdout.trim() : undefined));
  });
}

/**
 * macOS: `ps -o lstart= -p <pid>`, forced to `LC_ALL=C`/`TZ=UTC` so the date format doesn't depend
 * on the machine's locale or timezone (docs/spikes/F-procstart-por-so.md). **Not independently
 * verified on real macOS hardware — no Mac was available in this environment.** The command and
 * env are exactly what the spike documented; only the disambiguation-on-failure logic here is new.
 */
async function captureDarwin(pid: number, recheck: ExistenceRecheck): Promise<ProcStartCapture> {
  const stdout = await runForStdout('ps', ['-o', 'lstart=', '-p', String(pid)], {
    ...process.env,
    LC_ALL: 'C',
    TZ: 'UTC',
  });
  if (stdout === undefined || stdout.length === 0) {
    return afterFailure(pid, `"ps -o lstart= -p ${pid}" produced no usable output`, recheck);
  }
  return { kind: 'value', value: stdout };
}

/**
 * Windows: `(Get-Process -Id <pid>).StartTime` converted to `FileTimeUtc` — confirmed here (see
 * docs/spikes/F-procstart-por-so.md for the numbers) to be stable across repeated reads of the
 * same PID and to disagree with `Get-CimInstance ... CreationDate` in the low digits, matching the
 * spike's claim that the CIM path is imprecise. `-NoProfile` avoids paying for (and depending on)
 * the user's PowerShell profile on every liveness check.
 */
async function captureWindows(pid: number, recheck: ExistenceRecheck): Promise<ProcStartCapture> {
  const script = `(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`;
  const stdout = await runForStdout('powershell.exe', ['-NoProfile', '-Command', script]);
  if (stdout === undefined || !/^\d+$/.test(stdout)) {
    return afterFailure(
      pid,
      `PowerShell StartTime lookup for pid ${pid} failed or was not digits`,
      recheck,
    );
  }
  return { kind: 'value', value: stdout };
}

const CAPTURE_BY_PLATFORM: Record<string, typeof captureLinux> = {
  linux: captureLinux,
  darwin: captureDarwin,
  win32: captureWindows,
};

/**
 * Dispatches to the platform-specific capture above. An unrecognized `process.platform` (none of
 * the three this project supports) is `unavailable` rather than a thrown error — this project
 * only ships for Linux/macOS/Windows, so anything else means "no known way to read this here", the
 * same shape of not-knowing D-025 already asks for.
 */
export function captureObservedProcStart(
  pid: number,
  recheck: ExistenceRecheck,
  platform: string = process.platform,
): Promise<ProcStartCapture> {
  const capture = CAPTURE_BY_PLATFORM[platform];
  if (capture === undefined) {
    return Promise.resolve({
      kind: 'unavailable',
      reason: `no procStart capture strategy for platform "${platform}"`,
    });
  }
  return capture(pid, recheck);
}
