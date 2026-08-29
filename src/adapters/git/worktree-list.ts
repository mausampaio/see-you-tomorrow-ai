/**
 * Parses `git worktree list --porcelain`'s output (docs/ARQUITETURA.md § `git/` names this exact
 * command). Blocks are separated by a blank line, one block per worktree; within a block, each
 * line is `<key> <value>` (or a bare flag like `bare`/`detached`/`locked` with no value). Only the
 * two keys this project needs are read; every other line (`HEAD <sha>`, `locked [<reason>]`,
 * `prunable [<reason>]`, `bare`) is ignored on purpose — D-022's "tolerant of unknown fields"
 * applies here too, since git has added annotations to this format before and may again.
 */
export interface WorktreeListEntry {
  readonly path: string;
  /** `null` for `detached` (no `branch` line in the block) — see `WorktreeFacts.branch`. */
  readonly branch: string | null;
}

const BRANCH_REF_PREFIX = 'refs/heads/';

function branchFromLine(line: string): string {
  const ref = line.slice('branch '.length);
  return ref.startsWith(BRANCH_REF_PREFIX) ? ref.slice(BRANCH_REF_PREFIX.length) : ref;
}

function parseWorktreeBlock(block: string): WorktreeListEntry {
  let path = '';
  let branch: string | null = null;
  for (const line of block.split('\n')) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length);
    } else if (line.startsWith('branch ')) {
      branch = branchFromLine(line);
    }
  }
  return { path, branch };
}

export function parseWorktreeListPorcelain(stdout: string): WorktreeListEntry[] {
  return stdout
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map(parseWorktreeBlock)
    .filter((entry) => entry.path.length > 0);
}
