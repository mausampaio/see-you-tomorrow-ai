/**
 * `GitAdapter` against a real git repository built in `tmpdir` (docs/TESTES.md § "git/":
 * "repositório de teste construído em tmpdir com dois worktrees, um sujo e um limpo, commits
 * datados de hoje e de ontem. Verificar enumeração, estado por worktree e o recorte de 'commits
 * do dia'. Mais um caso com cwd que não é repositório.").
 *
 * `now` is always the injected `FakeClock`'s instant, built with the local-time `Date` constructor
 * (`new Date(year, month, day, ...)`) so this suite passes regardless of the host machine's
 * timezone — every commit instant below is derived from that same `now`, never from a literal UTC
 * string, so "today" and "yesterday" stay correct wherever this runs (D-019; the task that
 * requested this adapter singles out exactly this: a late-night commit must not roll over to the
 * next day just because UTC did).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitAdapter } from '../../../src/adapters/git/index.js';
import { runGit } from '../../../src/adapters/git/run-git.js';
import { FakeClock } from '../discovery/_fake-clock.js';
import {
  addWorktree,
  commitAt,
  createGitFixture,
  removeGitFixture,
  writeAndStage,
  type GitFixture,
} from './_fixtures.js';

/**
 * A snapshot of everything `readFacts` reads, good enough to detect any write: `HEAD`'s commit,
 * the reflog (grows on any ref update, including ones `git status`/`git log` would never trigger
 * on their own but a stray `commit`/`checkout` would), and the exact `status --porcelain` output
 * (unstaged/staged/untracked all show up here). AGENTS.md § "Fora de escopo": this adapter only
 * ever runs read-only commands (`status`, `log`, `branch --show-current`,
 * `rev-parse --is-inside-work-tree`, `worktree list`) — this test is what proves that claim by
 * execution instead of by code review alone.
 */
async function snapshot(dir: string): Promise<string> {
  const [head, reflog, status] = await Promise.all([
    runGit(dir, ['rev-parse', 'HEAD']),
    runGit(dir, ['reflog', 'show', '--all']),
    runGit(dir, ['status', '--porcelain=v1']),
  ]);
  return JSON.stringify({ head, reflog, status });
}

const NOW = new Date(2026, 7, 29, 12, 0, 0); // 2026-08-29, noon, local time
const TODAY_9AM = new Date(2026, 7, 29, 9, 0, 0);
const YESTERDAY_10PM = new Date(2026, 7, 28, 22, 0, 0);

let fixture: GitFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeGitFixture(fixture);
    fixture = undefined;
  }
});

/** Normalizes path separators so assertions don't depend on the host OS's own separator. */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('GitAdapter.readFacts — cwd that is not a repository', () => {
  it('answers { hasGit: false }, never a thrown error or an invented branch/dirty value', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'seeya-git-norepo-'));
    try {
      const adapter = new GitAdapter({ clock: new FakeClock(NOW) });
      const result = await adapter.readFacts(root);
      expect(result).toStrictEqual({ hasGit: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('GitAdapter.readFacts — one dirty main worktree, one clean linked worktree', () => {
  let worktreeDir: string;

  async function buildFixture(): Promise<void> {
    fixture = await createGitFixture();
    await writeAndStage(fixture.mainDir, 'a.txt', 'hello\n');
    await commitAt(fixture.mainDir, YESTERDAY_10PM, 'chore: initial commit');

    worktreeDir = await addWorktree(fixture, 'issue-42');

    await writeAndStage(fixture.mainDir, 'b.txt', 'today work\n');
    await commitAt(fixture.mainDir, TODAY_9AM, "feat: today's work");

    // Untracked file, never staged: proves `dirty`/`modifiedFiles` cover untracked work too.
    await writeFile(path.join(fixture.mainDir, 'untracked.txt'), 'wip\n', 'utf8');
  }

  it("main cwd: branch, dirty, modifiedFiles and only today's commit", async () => {
    await buildFixture();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readFacts(fixture!.mainDir);

    if (!result.hasGit) {
      throw new Error('expected hasGit: true for a real repository');
    }
    expect(result.facts.branch).toBe('main');
    expect(result.facts.dirty).toBe(true);
    expect(result.facts.modifiedFiles).toStrictEqual(['untracked.txt']);
    expect(result.facts.commitsToday).toHaveLength(1);
    const [todayCommit] = result.facts.commitsToday;
    expect(todayCommit?.title).toBe("feat: today's work");
    expect(todayCommit?.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(result.rejectedWorktrees).toStrictEqual([]);
  });

  it('lists the other (linked) worktree, clean, with 0 commits today', async () => {
    await buildFixture();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readFacts(fixture!.mainDir);

    if (!result.hasGit) {
      throw new Error('expected hasGit: true for a real repository');
    }
    expect(result.facts.worktrees).toHaveLength(1);
    const other = result.facts.worktrees[0]!;
    expect(toPosix(other.path)).toMatch(/\/issue-42$/);
    expect(other.branch).toBe('issue-42');
    expect(other.dirty).toBe(false);
    expect(other.commitsTodayCount).toBe(0);
  });

  it("does not list cwd's own worktree in worktrees[] (no self-duplication)", async () => {
    await buildFixture();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readFacts(fixture!.mainDir);

    if (!result.hasGit) {
      throw new Error('expected hasGit: true for a real repository');
    }
    const paths = result.facts.worktrees.map((w) => toPosix(w.path));
    expect(paths.some((p) => p.endsWith('/main'))).toBe(false);
  });

  it("from the linked worktree's own cwd, the *other* worktree (main, dirty) shows up instead", async () => {
    await buildFixture();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readFacts(worktreeDir);

    if (!result.hasGit) {
      throw new Error('expected hasGit: true for a real repository');
    }
    expect(result.facts.branch).toBe('issue-42');
    expect(result.facts.dirty).toBe(false);
    expect(result.facts.commitsToday).toStrictEqual([]);
    expect(result.facts.worktrees).toHaveLength(1);
    const main = result.facts.worktrees[0]!;
    expect(toPosix(main.path)).toMatch(/\/main$/);
    expect(main.branch).toBe('main');
    expect(main.dirty).toBe(true);
    expect(main.commitsTodayCount).toBe(1);
  });
});

describe('GitAdapter.readFacts — never writes to the repository (AGENTS.md § "Fora de escopo")', () => {
  let worktreeDir: string;

  async function buildFixture(): Promise<void> {
    fixture = await createGitFixture();
    await writeAndStage(fixture.mainDir, 'a.txt', 'hello\n');
    await commitAt(fixture.mainDir, YESTERDAY_10PM, 'chore: initial commit');
    worktreeDir = await addWorktree(fixture, 'issue-42');
    await writeAndStage(fixture.mainDir, 'b.txt', "today's work\n");
    await commitAt(fixture.mainDir, TODAY_9AM, "feat: today's work");
    await writeFile(path.join(fixture.mainDir, 'untracked.txt'), 'wip\n', 'utf8');
  }

  it('leaves the main worktree, the linked worktree and the shared .git identical before/after', async () => {
    await buildFixture();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const before = await Promise.all([snapshot(fixture!.mainDir), snapshot(worktreeDir)]);
    await adapter.readFacts(fixture!.mainDir);
    await adapter.readFacts(worktreeDir);
    const after = await Promise.all([snapshot(fixture!.mainDir), snapshot(worktreeDir)]);

    expect(after).toStrictEqual(before);
  });
});

describe('GitAdapter.readFacts — a worktree git still remembers but whose directory is gone (D-022)', () => {
  it('is reported as a rejection, visible and countable, without taking down the others', async () => {
    fixture = await createGitFixture();
    await writeAndStage(fixture.mainDir, 'a.txt', 'hello\n');
    await commitAt(fixture.mainDir, YESTERDAY_10PM, 'chore: initial commit');

    await addWorktree(fixture, 'issue-42');
    const goneWorktreeDir = await addWorktree(fixture, 'issue-99');
    // Removed straight from disk, not via `git worktree remove` -- `git worktree list` keeps
    // remembering it (the real "prunable" situation this test exists to reproduce), and any git
    // command targeting it now fails to even start (ENOENT on chdir).
    await rm(goneWorktreeDir, { recursive: true, force: true });

    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });
    const result = await adapter.readFacts(fixture.mainDir);

    if (!result.hasGit) {
      throw new Error('expected hasGit: true for a real repository');
    }
    const acceptedPaths = result.facts.worktrees.map((w) => toPosix(w.path));
    expect(acceptedPaths.some((p) => p.endsWith('/issue-42'))).toBe(true);
    expect(acceptedPaths.some((p) => p.endsWith('/issue-99'))).toBe(false);

    expect(result.rejectedWorktrees).toHaveLength(1);
    expect(toPosix(result.rejectedWorktrees[0]!.file)).toMatch(/\/issue-99$/);
    expect(result.rejectedWorktrees[0]!.reason.length).toBeGreaterThan(0);
  });
});
