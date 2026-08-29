/**
 * The one gate `GitAdapter.readFacts` runs before anything else: is `cwd` inside a git working
 * tree at all? `git rev-parse --is-inside-work-tree` is git's own documented way to ask exactly
 * that, printing `true`/`false` with exit code 0 inside a repo, and failing (non-zero, no useful
 * stdout) outside one — cheaper and more reliable than trying to spot "fatal: not a git
 * repository" in stderr text, which isn't a contract git publishes.
 */
import { runGit } from './run-git.js';

export async function isInsideWorkTree(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result.ran && result.exitCode === 0 && result.stdout.trim() === 'true';
}
