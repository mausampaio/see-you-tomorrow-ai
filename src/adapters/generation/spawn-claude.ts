/**
 * The one place this adapter calls `node:child_process.spawn` (AGENTS.md § "Processos": array
 * arguments, `shell: false`, never `exec` with an interpolated string — the `cwd`s this project
 * runs in have spaces and accents). Everything else in `adapters/generation` builds arguments and
 * interprets output; this file is the only one that touches a real process.
 *
 * **Hard timeout via `AbortSignal.timeout`, not `setTimeout` (D-019).** `setTimeout`/`setInterval`
 * are banned by name outside `adapters/clock/` (`eslint.config.js`'s `no-restricted-globals`) —
 * `AbortSignal.timeout(ms)` is a different global, resolves a bounded wait without this file ever
 * writing the literal identifier the guard watches for, and `child_process.spawn`'s own `signal`
 * option turns that into "kill the child and report why" for free, without this file reimplementing
 * a kill-after-deadline race by hand.
 *
 * **Stdin carries the prompt (D-015), never a CLI argument.** Confirmed for real (S2-T2, claude
 * 2.1.235): piping a file containing a newline, double and single quotes, `%`, and accented
 * Portuguese text through stdin with no positional prompt argument round-tripped byte-for-byte
 * through the model and back in `result` — this is the mechanism Spike C's mangled argument
 * should have used.
 */
import { spawn } from 'node:child_process';
import { GenerationError } from './errors.js';

export interface SpawnClaudeOptions {
  readonly claudeBinary: string;
  readonly args: readonly string[];
  readonly stdinContent: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

export interface ClaudeProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Node's `AbortSignal`-driven child-process cancellation reports itself as a DOMException-shaped
 * `AbortError` (`name === 'AbortError'`, `code === 'ABORT_ERR'`) on the `'error'` event — checked
 * both ways since neither alone is documented as the one stable contract. */
function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'AbortError' || code === 'ABORT_ERR';
}

/**
 * Spawns `claudeBinary` with `args`, writes `stdinContent` and closes stdin, and collects stdout
 * and stderr until the process closes. Resolves with the raw result on ANY exit code — the caller
 * (`run-generation.ts`) is what decides a non-zero code is a failure, keeping this function a
 * thin, honest wrapper around what the OS actually did. Rejects with a typed `GenerationError`
 * only for the two failures that happen before there's an exit code at all: the process never
 * started (`spawnError`), or it ran past `timeoutMs` and was killed (`timeout`).
 */
export function spawnClaude(options: SpawnClaudeOptions): Promise<ClaudeProcessResult> {
  const { claudeBinary, args, stdinContent, cwd, env, timeoutMs } = options;
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(claudeBinary, [...args], {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(timeoutMs),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        isAbortError(error)
          ? new GenerationError({ kind: 'timeout', timeoutMs })
          : new GenerationError({ kind: 'spawnError', message: error.message }),
      );
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      // A `null` code with no prior `'error'` means the process died by signal without going
      // through the abort path above (e.g. something external killed it) — reported as -1 rather
      // than coerced to 0, so `run-generation.ts`'s "exit code !== 0" check still catches it.
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
    // `stdin` is typed nullable on the general `ChildProcess` overload even though
    // `stdio: ['pipe', ...]` above guarantees a real pipe at runtime — checked explicitly instead
    // of asserted away (AGENTS.md: `!`/`as` are a sign the type is wrong, not that the author
    // knows better), even though reaching the `else` branch would mean Node itself broke its own
    // contract for the `stdio` we asked for.
    if (child.stdin === null) {
      settled = true;
      reject(
        new GenerationError({ kind: 'spawnError', message: 'child process has no stdin pipe' }),
      );
      return;
    }
    child.stdin.write(stdinContent, 'utf8');
    child.stdin.end();
  });
}
