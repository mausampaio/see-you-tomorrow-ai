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

/**
 * The shape `runForStdout` below has — and the seam `proc-start.ts#captureObservedProcStart`
 * injects it through (S4-T0f, docs/QUESTOES.md Q-047), the same `CommandRunner` idea already named
 * in `adapters/notification/backend.ts` for the identical reason: a caller can substitute a fake
 * that resolves instantly, so a test exercises the real dispatch and branching without ever paying
 * for a real `ps`/`powershell.exe` launch.
 */
export type CommandRunner = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => Promise<string | undefined>;

export const runForStdout: CommandRunner = (command, args, env) => {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], shell: false, env });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => resolve(code === 0 ? stdout.trim() : undefined));
  });
};
