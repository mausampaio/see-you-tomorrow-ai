/**
 * The small git-command primitives (`readBranch`, `readModifiedFiles`, `readCommitsToday`) on
 * their own, isolating the two failure shapes `run-git.ts#GitCommandResult` distinguishes
 * (`ran: false` vs. a real nonzero git exit code) instead of only reaching them indirectly through
 * `GitAdapter.readFacts` (`git-adapter.test.ts`). Both are D-025 cases: neither is an error this
 * project surfaces, both degrade to the least-specific value each function's return type allows.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readBranch } from '../../../src/adapters/git/branch.js';
import { readModifiedFiles } from '../../../src/adapters/git/status.js';
import { readCommitsToday } from '../../../src/adapters/git/commits.js';
import { createGitFixture, removeGitFixture, type GitFixture } from './_fixtures.js';

const NOW = new Date(2026, 7, 29, 12, 0, 0);

describe('git primitives — workingDir that git cannot even start in (`ran: false`)', () => {
  it('readBranch: null, not a thrown error', async () => {
    const missing = path.join(tmpdir(), 'seeya-git-does-not-exist-at-all');
    await expect(readBranch(missing)).resolves.toBeNull();
  });

  it('readModifiedFiles: empty list, not a thrown error', async () => {
    const missing = path.join(tmpdir(), 'seeya-git-does-not-exist-at-all');
    await expect(readModifiedFiles(missing)).resolves.toStrictEqual([]);
  });

  it('readCommitsToday: empty list, not a thrown error', async () => {
    const missing = path.join(tmpdir(), 'seeya-git-does-not-exist-at-all');
    await expect(readCommitsToday(missing, NOW)).resolves.toStrictEqual([]);
  });
});

describe('git primitives — a real repository with zero commits yet (`ran: true`, nonzero exit)', () => {
  let fixture: GitFixture | undefined;

  afterEach(async () => {
    if (fixture !== undefined) {
      await removeGitFixture(fixture);
      fixture = undefined;
    }
  });

  it("readCommitsToday: empty list — 'no commits yet' is ordinary, not a rejection", async () => {
    fixture = await createGitFixture();

    const commits = await readCommitsToday(fixture.mainDir, NOW);

    expect(commits).toStrictEqual([]);
  });

  it('readBranch: still reports the checked-out branch even with no commits', async () => {
    fixture = await createGitFixture();
    // `mkdtemp`-created dirs never collide, but assert the fixture's own claim (branch `main`,
    // `--initial-branch=main`) so this test also fails loudly if that setup ever changes silently.
    const branch = await readBranch(fixture.mainDir);
    expect(branch).toBe('main');
  });
});

describe('a plain, empty directory (never `git init`ed at all)', () => {
  it('readModifiedFiles: empty list (git itself reports "not a repository", a real nonzero exit)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'seeya-git-plain-'));
    try {
      await expect(readModifiedFiles(root)).resolves.toStrictEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
