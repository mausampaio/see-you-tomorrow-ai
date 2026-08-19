/**
 * Runs `command` with `args` (array, `shell: false` — AGENTS.md § "Processos": never `exec` with
 * an interpolated string), returning trimmed stdout on a zero exit code, or `undefined` on any
 * failure (spawn error, non-zero exit). Shared by every per-platform capture in this adapter that
 * shells out to an OS tool instead of reading a file directly — `proc-start.ts` (macOS/Windows
 * `procStart`) and `inspection.ts` (macOS `cwd`/command line) both need this, so it's extracted
 * here instead of each carrying its own copy of the same ten lines (AGENTS.md: "nada de
 * duplicação"). Originally lived only inside `proc-start.ts`.
 */
import { spawn } from 'node:child_process';

export function runForStdout(
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
