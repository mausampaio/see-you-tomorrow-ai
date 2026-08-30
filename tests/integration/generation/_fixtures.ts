/**
 * Puts a fake `claude` on disk, backed by `tests/fixtures/generation/fake-claude.mjs`
 * (docs/TESTES.md § `generation/`). `createFakeClaudeFixture()` returns an absolute
 * `binaryPath` — pass it as `claudeBinary` to `LeanHandoffGenerator`/`DeepHandoffGenerator`
 * rather than relying on `PATH` search (measured on this machine: prepending to `PATH` let
 * Windows' extension search resolve the REAL `claude.exe` installed elsewhere on `PATH` ahead of
 * this fixture, since `.EXE` outranks `.CMD` in `PATHEXT` regardless of directory order).
 *
 * **Windows needs a real compiled `.exe`, not a `.cmd`/`.bat` launcher.** Measured on this
 * machine (Node 22.19, S2-T2): `spawn(cmdPath, args, {shell:false})` throws a SYNCHRONOUS
 * `EINVAL` for any `.cmd`/`.bat` target — Node's fix for CVE-2024-27980 (batch-file argument
 * injection) refuses to launch one at all unless `shell:true`, which production's
 * `spawn-claude.ts` never sets (correctly: the real `claude` is a native `.exe`, D-015's
 * `shell:false` is exactly right there). A `.cmd` wrapper would make this test harness lie about
 * what production actually does, not just fail to compile. The fix here is test-only: compile a
 * tiny native passthrough launcher with the C# compiler every Windows machine ships as part of
 * the .NET Framework runtime (`csc.exe` — present without a Visual Studio/SDK install), which
 * just re-execs `node <fake-claude.mjs> <args...>` inheriting stdio, so the exact same
 * `shell:false` code path production uses is what every generation test also exercises.
 */
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FAKE_CLAUDE_SCRIPT = fileURLToPath(
  new URL('../../fixtures/generation/fake-claude.mjs', import.meta.url),
);

export interface FakeClaudeFixture {
  readonly dir: string;
  /** Absolute path to the launcher — pass this as `claudeBinary`. Production always spawns the
   * bare name `claude`, resolved by whatever `PATH` the user's machine has; pinning an absolute
   * path here is a test-harness concern only, to sidestep `PATH`-search ambiguity entirely. */
  readonly binaryPath: string;
  /** Where the fake script writes `{argv, stdin, env}` — set as `FAKE_CLAUDE_CAPTURE_FILE`. */
  readonly captureFile: string;
}

const CSC_CANDIDATES = [
  path.join(
    process.env['WINDIR'] ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  ),
  path.join(
    process.env['WINDIR'] ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework',
    'v4.0.30319',
    'csc.exe',
  ),
];

function findCsc(): string {
  const found = CSC_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `no C# compiler (csc.exe) found among: ${CSC_CANDIDATES.join(', ')}. This Windows-only ` +
        "test fixture needs it to build a real .exe launcher (see _fixtures.ts's top comment " +
        'for why a .cmd wrapper does not work).',
    );
  }
  return found;
}

/** Escapes `value` as a C# regular (non-verbatim) string literal body. */
function csharpStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * A native passthrough launcher: re-execs `nodePath scriptPath <received argv>`, with the
 * child's own stdio inherited (no redirection — `UseShellExecute = false` and no
 * `RedirectStandard*` means the grandchild sees the exact same pipes THIS process was given,
 * which is what forwards the test's piped stdin down through two process hops intact) and the
 * child's exit code propagated. `Arguments` is a single command-line string (old .NET Framework
 * has no `ArgumentList`), rebuilt with the same quoting `CommandLineToArgvW` expects — confirmed
 * for real (S2-T2): a value containing a newline, both quote styles, `%` and accented text round
 * -tripped through this exact shim into a real spawned Node process without corruption.
 */
function buildShimSource(nodePath: string, scriptPath: string): string {
  return `using System;
using System.Diagnostics;
using System.Text;

class Shim
{
    static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new char[] { ' ', '\\t', '"' }) < 0)
        {
            return arg;
        }
        var sb = new StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\\\')
            {
                backslashes++;
                continue;
            }
            if (c == '"')
            {
                sb.Append('\\\\', backslashes * 2 + 1);
                sb.Append('"');
                backslashes = 0;
                continue;
            }
            sb.Append('\\\\', backslashes);
            backslashes = 0;
            sb.Append(c);
        }
        sb.Append('\\\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    static int Main(string[] args)
    {
        var quoted = new StringBuilder();
        quoted.Append(Quote("${csharpStringLiteral(scriptPath)}"));
        foreach (var a in args)
        {
            quoted.Append(' ');
            quoted.Append(Quote(a));
        }
        var psi = new ProcessStartInfo
        {
            FileName = "${csharpStringLiteral(nodePath)}",
            Arguments = quoted.ToString(),
            UseShellExecute = false,
        };
        var process = Process.Start(psi);
        process.WaitForExit();
        return process.ExitCode;
    }
}
`;
}

/**
 * Set by `_windows-shim-global-setup.ts` before any worker starts (S2-T8). Vitest isolates each
 * test file's module registry by default, so the per-process memoization below only dedupes
 * calls WITHIN one file — every file importing this module still paid its own `csc.exe` compile.
 * Measured on this dev machine (`npm test`, the two files that use this fixture today —
 * `lean-generator.test.ts` and `deep-generator.test.ts` — each in their own worker process):
 * 317ms and 344ms, cheap here. On a cold, contended CI runner the same compile is far more
 * expensive, and having it happen twice AT ONCE (both workers competing for the same CPU) is
 * worse than the sum of the two — that contention, not the compile itself, produced "Hook timed
 * out in 10000ms" in the Windows CI run this task investigates.
 */
export const WINDOWS_SHIM_PATH_ENV_VAR = 'SEEYA_TEST_WINDOWS_CLAUDE_SHIM_PATH';

/** Compiled once per test process and reused by every fixture instance (S2-T2 measured `csc.exe`
 * cold-start as non-trivial; dozens of tests each calling `createFakeClaudeFixture()` would
 * otherwise recompile an identical launcher dozens of times). Never cleaned up by
 * `removeFakeClaudeFixture` — it's a shared, immutable artifact for the whole process lifetime,
 * in its own `tmpdir()` entry the OS reclaims on its own schedule, same as the rest of `tmpdir()`. */
let windowsShimPath: Promise<string> | undefined;

export async function compileWindowsShim(): Promise<string> {
  const shimDir = await mkdtemp(path.join(tmpdir(), 'seeya-fake-claude-shim-'));
  const sourcePath = path.join(shimDir, 'shim.cs');
  const exePath = path.join(shimDir, 'claude.exe');
  await writeFile(sourcePath, buildShimSource(process.execPath, FAKE_CLAUDE_SCRIPT), 'utf8');
  await execFileAsync(findCsc(), ['/nologo', `/out:${exePath}`, sourcePath]);
  return exePath;
}

/** Prefers the shim `_windows-shim-global-setup.ts` already built once for the whole run (the
 * `integration` project wires that global setup up; `existsSync` is a cheap guard against the
 * unlikely case its teardown already ran). Any other project or a one-off single-file run falls
 * back to the old per-process compile — slower, but correct, exactly what happened before S2-T8. */
function getWindowsShimBinary(): Promise<string> {
  const fromGlobalSetup = process.env[WINDOWS_SHIM_PATH_ENV_VAR];
  if (fromGlobalSetup !== undefined && existsSync(fromGlobalSetup)) {
    return Promise.resolve(fromGlobalSetup);
  }
  windowsShimPath ??= compileWindowsShim();
  return windowsShimPath;
}

/** POSIX: a plain shebang script works fine with `shell:false` — no EINVAL restriction exists
 * here, this is the Windows-only workaround. `"$@"` (never a hand-built string) is the standard
 * safe argument-forwarding idiom. */
async function writePosixLauncher(dir: string): Promise<string> {
  const scriptPath = path.join(dir, 'claude');
  await writeFile(
    scriptPath,
    `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLAUDE_SCRIPT}" "$@"\n`,
    'utf8',
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function createFakeClaudeFixture(): Promise<FakeClaudeFixture> {
  const dir = await mkdtemp(path.join(tmpdir(), 'seeya-fake-claude-'));
  const captureFile = path.join(dir, 'capture.json');
  const binaryPath =
    process.platform === 'win32' ? await getWindowsShimBinary() : await writePosixLauncher(dir);
  return { dir, binaryPath, captureFile };
}

export async function removeFakeClaudeFixture(fixture: FakeClaudeFixture): Promise<void> {
  await rm(fixture.dir, { recursive: true, force: true });
}

export interface CapturedClaudeCall {
  readonly argv: string[];
  readonly stdin: string;
  readonly env: Record<string, string | undefined>;
}

/** Reads back what the fake `claude` process actually received — the proof instrument for D-015
 * (stdin integrity) and D-017 (env sanitization). Throws if the fake process was never actually
 * run (no capture file), which is itself a useful test failure. */
export async function readCapturedClaudeCall(
  fixture: FakeClaudeFixture,
): Promise<CapturedClaudeCall> {
  const text = await readFile(fixture.captureFile, 'utf8');
  return JSON.parse(text) as CapturedClaudeCall;
}
