import { describe, expect, it } from 'vitest';
import { parseWorktreeListPorcelain } from '../../../../src/adapters/git/worktree-list.js';

describe('parseWorktreeListPorcelain', () => {
  it('empty output is an empty list', () => {
    expect(parseWorktreeListPorcelain('')).toStrictEqual([]);
  });

  it('a single worktree on a branch', () => {
    const stdout = 'worktree /code/project\nHEAD abc123\nbranch refs/heads/main\n';
    expect(parseWorktreeListPorcelain(stdout)).toStrictEqual([
      { path: '/code/project', branch: 'main' },
    ]);
  });

  it('two worktrees, separated by a blank line', () => {
    const stdout =
      'worktree /code/project\nHEAD abc123\nbranch refs/heads/main\n' +
      '\n' +
      'worktree /code/project/.wt/issue-42\nHEAD def456\nbranch refs/heads/issue-42\n';

    expect(parseWorktreeListPorcelain(stdout)).toStrictEqual([
      { path: '/code/project', branch: 'main' },
      { path: '/code/project/.wt/issue-42', branch: 'issue-42' },
    ]);
  });

  it('a detached worktree (no branch line) has branch: null', () => {
    const stdout = 'worktree /code/project/.wt/detached\nHEAD abc123\ndetached\n';
    expect(parseWorktreeListPorcelain(stdout)).toStrictEqual([
      { path: '/code/project/.wt/detached', branch: null },
    ]);
  });

  it('a branch line without the refs/heads/ prefix is kept as-is (defensive, not expected from real git)', () => {
    const stdout = 'worktree /code/project\nHEAD abc123\nbranch something-unusual\n';
    expect(parseWorktreeListPorcelain(stdout)).toStrictEqual([
      { path: '/code/project', branch: 'something-unusual' },
    ]);
  });

  it('ignores unknown annotation lines (locked, prunable) without failing', () => {
    const stdout =
      'worktree /code/project/.wt/locked-one\nHEAD abc123\nbranch refs/heads/wip\n' +
      'locked some reason\n';
    expect(parseWorktreeListPorcelain(stdout)).toStrictEqual([
      { path: '/code/project/.wt/locked-one', branch: 'wip' },
    ]);
  });
});
