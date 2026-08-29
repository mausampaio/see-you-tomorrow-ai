/**
 * Runs `git <args>` inside `workingDir` (`spawn` with an array and `shell: false` — AGENTS.md §
 * "Processos": never build a command by string interpolation; `cwd` values in this project
 * routinely carry spaces and accents that a shell would mangle).
 *
 * A separate, small implementation rather than reusing `adapters/process/spawn-stdout.ts`'s
 * `runForStdout`: that helper has no `cwd` option (its two callers, both in `proc-start.ts`, only
 * ever query the current process's own directory), and every command here needs one — for the
 * main `cwd` and, per worktree, for that worktree's own directory. Adding `cwd` there would touch
 * a file `adapters/process` owns for a caller `adapters/git` doesn't share.
 */
import { spawn } from 'node:child_process';

/**
 * Discriminated on `ran`, not a bare exit code with a magic sentinel (D-024's reasoning applied
 * here too): `ran: false` is "this command never produced a real git exit code at all" — the
 * binary is missing, or `workingDir` doesn't exist to `chdir` into, or the process was killed by
 * a signal. That is a categorically different failure from `ran: true, exitCode: 128` (git ran
 * fine and reported, in its own normal way, e.g. "not a repository" or "no commits yet") — the two
 * callers in this adapter tell them apart on purpose: a real git exit code degrades gracefully to
 * "no data" (D-025), while `ran: false` for one *worktree* is what D-022 calls a rejectable item
 * (most commonly, `git worktree list` still remembering a directory that's gone from disk).
 */
export type GitCommandResult =
  | { readonly ran: true; readonly stdout: string; readonly exitCode: number }
  | { readonly ran: false; readonly reason: string };

/** Never rejects — every failure mode above is reported through the return value. */
export function runGit(workingDir: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', (error) => resolve({ ran: false, reason: String(error) }));
    child.on('close', (code, signal) => {
      if (code === null) {
        resolve({ ran: false, reason: `terminated by signal ${signal ?? 'unknown'}` });
        return;
      }
      resolve({ ran: true, stdout, exitCode: code });
    });
  });
}
