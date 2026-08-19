/**
 * Runs `command` with `args` (array, `shell: false` — AGENTS.md § "Processos": never `exec` with
 * an interpolated string), returning trimmed stdout on a zero exit code, or `undefined` on any
 * failure (spawn error, non-zero exit). Extracted out of `proc-start.ts` (macOS/Windows
 * `procStart`), which still uses it, instead of that module carrying it inline.
 *
 * **Also used by `inspection.ts` (macOS `cwd`/command line) between S1-T10 and S1-T11 — removed
 * with that module in S1-T11 (D-029).** Kept here on its own, unchanged: `proc-start.ts` is still
 * a live caller, so this file stays despite losing its second one (docs/PLANO-DE-ENTREGA.md
 * S1-T11's own warning not to delete it along with `inspection.ts`).
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
