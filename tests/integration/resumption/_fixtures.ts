/**
 * Puts a fake `claude` on disk, backed by `tests/fixtures/resumption/fake-claude-interactive.mjs`
 * (S3-T2). Same technique `tests/integration/generation/_fixtures.ts` uses (S2-T2) — Windows needs
 * a real compiled `.exe`, not a `.cmd`/`.bat` launcher, because `spawn(path, args, {shell:false})`
 * throws a synchronous `EINVAL` for a batch-file target (Node's CVE-2024-27980 fix) — but
 * **deliberately self-contained rather than reused**: that module's Windows shim bakes its own
 * fake-claude script's path into the compiled `.exe` at compile time, and its cache is a single
 * global slot precompiled once per whole test run (S2-T8, wired into `vitest.config.ts`'s
 * `globalSetup` for CI performance). Generalizing it to serve a second, differently-behaved script
 * would mean either threading a script path through that precompiled global cache (touching S2-T8's
 * tuned infra for a fixture it doesn't otherwise need) or two script identities behind one binary —
 * both a bigger blast radius on shared, already-tested infrastructure than this task's own,
 * independent shim justifies. Compiling a second, small `.exe` costs low-hundreds of ms (S2-T2
 * measured 317-344ms for the original one) — cheap enough not to need S2-T8's whole-run caching for
 * the one or two files that use it today; if a third resumption test file makes that cost add up,
 * the same global-setup treatment applies then, not speculatively now.
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
  new URL('../../fixtures/resumption/fake-claude-interactive.mjs', import.meta.url),
);

export interface FakeInteractiveClaudeFixture {
  readonly dir: string;
  /** Absolute path to the launcher — pass this as `claudeBinary`. */
  readonly binaryPath: string;
  /** Where the fake script writes `{argv, env}` — set as `FAKE_CLAUDE_CAPTURE_FILE`. */
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
        "test fixture needs it to build a real .exe launcher (see this file's top comment).",
    );
  }
  return found;
}

function csharpStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * A native passthrough launcher: re-execs `nodePath scriptPath <received argv>`, with the child's
 * stdio inherited — `UseShellExecute = false` and no `RedirectStandard*` forwards the exact same
 * pipes/TTY this process was given, which is what `spawn-interactive.ts`'s `stdio: 'inherit'`
 * contract needs proven through two process hops, not just one. Quoting logic copied from
 * `tests/integration/generation/_fixtures.ts#buildShimSource`, which confirmed for real (S2-T2)
 * that this exact quoting round-trips a newline/both-quote-styles/`%`/accented string intact.
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

/** Memoized per test-worker process (not a whole-run global cache — see this file's top comment
 * for why S2-T8's precompiled global slot isn't reused here). Never cleaned up: a small, immutable
 * artifact in its own `tmpdir()` entry the OS reclaims on its own schedule. */
let windowsShimPath: Promise<string> | undefined;

async function compileWindowsShim(): Promise<string> {
  const shimDir = await mkdtemp(path.join(tmpdir(), 'seeya-fake-claude-interactive-shim-'));
  const sourcePath = path.join(shimDir, 'shim.cs');
  const exePath = path.join(shimDir, 'claude.exe');
  await writeFile(sourcePath, buildShimSource(process.execPath, FAKE_CLAUDE_SCRIPT), 'utf8');
  await execFileAsync(findCsc(), ['/nologo', `/out:${exePath}`, sourcePath]);
  return exePath;
}

function getWindowsShimBinary(): Promise<string> {
  windowsShimPath ??= compileWindowsShim();
  return windowsShimPath;
}

/** POSIX: a plain shebang script works fine with `shell:false` (no `EINVAL` restriction there). */
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

export async function createFakeInteractiveClaudeFixture(): Promise<FakeInteractiveClaudeFixture> {
  const dir = await mkdtemp(path.join(tmpdir(), 'seeya-fake-claude-interactive-'));
  const captureFile = path.join(dir, 'capture.json');
  const binaryPath =
    process.platform === 'win32' ? await getWindowsShimBinary() : await writePosixLauncher(dir);
  return { dir, binaryPath, captureFile };
}

export async function removeFakeInteractiveClaudeFixture(
  fixture: FakeInteractiveClaudeFixture,
): Promise<void> {
  await rm(fixture.dir, { recursive: true, force: true });
}

export interface CapturedInteractiveClaudeCall {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  /** Content of the file named after `--append-system-prompt-file`, read by the fake process
   * itself before `resumer.ts`'s cleanup deletes it — `null` when that flag wasn't present. */
  readonly contextFileContent: string | null;
}

/**
 * Reads back every invocation of the fake process, in order — one JSON line per call (the fixture
 * script appends rather than overwrites, since a resume-then-fallback sequence spawns it twice).
 * Throws if it never ran at all (no capture file), itself a useful failure.
 */
export async function readCapturedInteractiveClaudeCalls(
  fixture: FakeInteractiveClaudeFixture,
): Promise<CapturedInteractiveClaudeCall[]> {
  const text = await readFile(fixture.captureFile, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as CapturedInteractiveClaudeCall);
}
