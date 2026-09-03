/**
 * Finds the git repository root reachable by walking up from a path — D-032's own rule for
 * deriving evidence from touched files instead of the session's launch `cwd`: "sobe de cada
 * arquivo até achar um `.git`, desduplica pela raiz". A plain `.git` existence check (`fs.stat`),
 * not a `git rev-parse --show-toplevel` subprocess per file: cheaper when a session may have
 * touched dozens of files, and correct for the same reason `adapters/git/repo.ts#isInsideWorkTree`
 * trusts a single well-known marker instead of parsing git's own output — a `.git` entry (a
 * directory for an ordinary clone, a file with a `gitdir:` pointer for a worktree or submodule, per
 * git's own documented layout) is exactly what marks a directory as a repository root, and this
 * module never needs to tell the two kinds apart.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';

/** Never throws (D-025): a directory this can't stat — most commonly `.git` simply doesn't exist
 * there — answers `false`, the same as "no repository marker here", not a distinguishable failure
 * the caller would need to react to differently. */
async function hasDotGit(dir: string): Promise<boolean> {
  try {
    await stat(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks up from `startPath` until a `.git` entry is found. `startPath` may be a file or a
 * directory — passing a file costs one harmless wasted `stat` (`<file>/.git`, which can never
 * exist) before the walk reaches the file's actual directory, so callers don't need to
 * `path.dirname()` first.
 *
 * Never throws (D-025): `null` means the walk reached the filesystem root without finding a
 * repository — a path outside any repository is a real, ordinary case, not a failure.
 *
 * @example
 * await findRepoRoot('C:\\code\\project\\src\\a.ts'); // 'C:\\code\\project' (if it's a repo)
 * await findRepoRoot('C:\\code'); // null (not inside any repository)
 */
export async function findRepoRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  let parent = path.dirname(current);
  while (parent !== current) {
    if (await hasDotGit(current)) {
      return current;
    }
    current = parent;
    parent = path.dirname(current);
  }
  // `current` is now the filesystem root itself (`path.dirname(root) === root`) — check it too,
  // instead of stopping one level short of the walk's own terminating condition.
  return (await hasDotGit(current)) ? current : null;
}
