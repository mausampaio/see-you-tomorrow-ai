/**
 * The checked-out branch of a working directory (main `cwd`, D-013 — worktrees get their branch
 * straight from `git worktree list`'s own output instead, see `worktree-list.ts`, so this
 * function only has one caller). `git branch --show-current` (git >= 2.22) is used over
 * `git rev-parse --abbrev-ref HEAD` on purpose: the latter prints the literal string `"HEAD"` on a
 * detached checkout, which would have to be special-cased back into `null`, while
 * `--show-current` already prints nothing (empty stdout, exit 0) for that same case.
 */
import { runGit } from './run-git.js';

/**
 * Never throws. `null` covers two different situations this return type doesn't need to tell
 * apart (D-025: both are "no branch name known", the least-specific answer this field supports) —
 * a real, ordinary detached `HEAD` (`ran: true`, empty stdout), and `git` never producing a real
 * exit code at all (`ran: false`, e.g. `workingDir` gone). The one caller that needs to tell a
 * missing directory apart from a real detached `HEAD` (the per-worktree pipeline, D-022) checks
 * `runGit`'s `status` call directly instead of going through this function — see
 * `git-adapter.ts#readWorktreeFacts`.
 */
export async function readBranch(workingDir: string): Promise<string | null> {
  const result = await runGit(workingDir, ['branch', '--show-current']);
  if (!result.ran) {
    return null;
  }
  const branch = result.stdout.trim();
  return branch.length > 0 ? branch : null;
}
