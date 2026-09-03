/**
 * Git adapter: branch, status, today's commits, and worktree enumeration for each session's
 * `cwd`. See docs/ARQUITETURA.md § `git/` and D-013.
 */
export { GitAdapter, type GitAdapterOptions, MAX_GIT_ROOTS_TO_VISIT } from './git-adapter.js';
export { localDayBounds, isWithinLocalDay, type LocalDayBounds } from './local-day.js';
export { parseStatusPorcelain } from './status.js';
export { parseCommitLog } from './commits.js';
export { parseWorktreeListPorcelain, type WorktreeListEntry } from './worktree-list.js';
export { isInsideWorkTree } from './repo.js';
export { readBranch } from './branch.js';
export { findRepoRoot } from './repo-roots.js';
