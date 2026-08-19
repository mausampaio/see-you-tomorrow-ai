/**
 * Reads a **live** PID's working directory and command line straight from the OS — the two facts
 * D-023's third discovery strategy (S1-T10, `adapters/discovery/process-key.ts`) needs and that
 * neither the registry (S1-T3) nor a transcript (S1-T8) can give for that shape of session: a
 * `.key` file with no matching `.json`, with nothing to read but the PID in its own file name.
 *
 * This module never touches `~/.claude/sessions/` and never reads a `.key` file's content — by
 * the time a PID reaches here, the discovery adapter has already decided it's a candidate from
 * the file *name* alone. Everything below only inspects the OS process itself, and only for the
 * specific candidate PIDs the discovery adapter passes in — never a broad enumeration of every
 * process on the machine, which would read (and risk logging) far more than this strategy needs.
 *
 * **Privacy note, not fully resolved — see docs/QUESTOES.md Q-011.** The command line this module
 * returns is exactly what the OS reports, unredacted: a classic place for a secret to leak
 * (a token or password passed as an argument), and D-023 says explicitly that this value is meant
 * to become handoff content written to disk. This module narrows the *exposure* (only candidate
 * PIDs, never every process) but doesn't redact the *content* — that's a product decision Q-011
 * asks the PO to make, not something to decide unilaterally here.
 *
 * Same per-platform split as `proc-start.ts`, and the same reason (docs/spikes/F-procstart-por-
 * so.md's finding generalizes: the three platforms don't expose this to an unrelated process the
 * same way):
 *
 * | Platform | `cwd` source                        | command line source                 |
 * |----------|--------------------------------------|--------------------------------------|
 * | Linux    | `readlink /proc/<pid>/cwd`            | `/proc/<pid>/cmdline` (NUL-joined)    |
 * | macOS    | `lsof -a -p <pid> -d cwd -Fn`          | `ps -ww -o command= -p <pid>`         |
 * | Windows  | unavailable without native code (D-023) | unavailable — see below             |
 *
 * **Windows is `null` by construction, not an oversight.** D-023 measured that reading an
 * arbitrary PID's `cwd` on Windows needs native code this project doesn't have — accepted,
 * because on Windows this class of session already produces a normal `<pid>.json` registry entry
 * too (S1-T3 discovers it there), so this strategy never has anything to fill in on that platform.
 * Since `cwd` already blocks every session from this source on Windows
 * (`adapters/discovery/process-key.ts` rejects a candidate with no `cwd`), command-line capture
 * isn't implemented there either — there would never be a session left for it to describe.
 *
 * **macOS is not independently verified on real hardware** — no Mac was available while writing
 * this, same caveat `proc-start.ts#captureDarwin` already carries for the same reason. The `lsof`
 * command for `cwd` is what D-023 measured; the `ps -ww -o command=` for the full command line
 * (`-ww` disables `ps`'s default truncation) is this module's own choice, unverified on hardware.
 */
import { readFile, readlink } from 'node:fs/promises';
import { runForStdout } from './spawn-stdout.js';

const NUL = '\0';

/**
 * Parses `lsof -a -p <pid> -d cwd -Fn` output: one field per line, each prefixed by a single
 * identifier letter (`p` pid, `f` file descriptor, `n` name). Filtering to the `cwd` descriptor
 * with `-d cwd` means the one `n`-prefixed line, when present, is the working directory itself.
 */
export function parseLsofCwdOutput(output: string): string | undefined {
  const nameLine = output.split('\n').find((line) => line.startsWith('n'));
  if (nameLine === undefined) {
    return undefined;
  }
  const value = nameLine.slice(1).trim();
  return value.length > 0 ? value : undefined;
}

/**
 * Parses `/proc/<pid>/cmdline`: arguments separated (and terminated) by NUL bytes, not spaces —
 * an argument can itself contain a space, so splitting on NUL is the only correct boundary.
 * Rejoined with a single space for a human-readable command line (D-023: "a linha de comando é
 * fonte de handoff"); the exact original argument boundaries aren't needed for that purpose.
 * Empty input (a kernel thread, or a process that exited right as this read happened) has no
 * arguments to report.
 */
export function parseProcCmdline(raw: string): string | undefined {
  const args = raw.split(NUL).filter((arg) => arg.length > 0);
  return args.length > 0 ? args.join(' ') : undefined;
}

async function readCwdLinux(pid: number): Promise<string | null> {
  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

async function readCwdDarwin(pid: number): Promise<string | null> {
  const stdout = await runForStdout('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  if (stdout === undefined) {
    return null;
  }
  return parseLsofCwdOutput(stdout) ?? null;
}

// See the module docstring: no native-code path exists in this project, and none is needed —
// this class of session already registers a normal <pid>.json on Windows (S1-T3).
function readCwdWindows(): Promise<string | null> {
  return Promise.resolve(null);
}

async function readCommandLineLinux(pid: number): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(`/proc/${pid}/cmdline`, 'utf8');
  } catch {
    return null;
  }
  return parseProcCmdline(raw) ?? null;
}

async function readCommandLineDarwin(pid: number): Promise<string | null> {
  const stdout = await runForStdout('ps', ['-ww', '-o', 'command=', '-p', String(pid)]);
  return stdout !== undefined && stdout.length > 0 ? stdout : null;
}

// See the module docstring: cwd is already unavailable on Windows for this strategy, so there is
// never a session left for a command line to describe — not implemented there either.
function readCommandLineWindows(): Promise<string | null> {
  return Promise.resolve(null);
}

const READ_CWD_BY_PLATFORM: Record<string, (pid: number) => Promise<string | null>> = {
  linux: readCwdLinux,
  darwin: readCwdDarwin,
  win32: readCwdWindows,
};

const READ_COMMAND_LINE_BY_PLATFORM: Record<string, (pid: number) => Promise<string | null>> = {
  linux: readCommandLineLinux,
  darwin: readCommandLineDarwin,
  win32: readCommandLineWindows,
};

/**
 * `ProcessControl.readCwd` (`core/ports.ts`). `platform` defaults to `process.platform` and is
 * only a parameter so tests can drive every branch without needing to run on all three OSes
 * (same testability shape as `proc-start.ts#captureObservedProcStart`). An unrecognized platform
 * is `null`, the same "no known way to read this here" answer D-025 already asks for elsewhere in
 * this adapter — this project only ships for Linux/macOS/Windows.
 */
export function readCwd(pid: number, platform: string = process.platform): Promise<string | null> {
  const capture = READ_CWD_BY_PLATFORM[platform];
  return capture === undefined ? Promise.resolve(null) : capture(pid);
}

/** `ProcessControl.readCommandLine` (`core/ports.ts`). See `readCwd`'s docstring for the
 * `platform` parameter and the unrecognized-platform answer. */
export function readCommandLine(
  pid: number,
  platform: string = process.platform,
): Promise<string | null> {
  const capture = READ_COMMAND_LINE_BY_PLATFORM[platform];
  return capture === undefined ? Promise.resolve(null) : capture(pid);
}
