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
  createAlias,
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

/**
 * Regression for the real production bug the CI matrix caught (not a test-environment quirk):
 * `git worktree list` reports the *resolved* path of the worktree it's run from, while a caller
 * reaching that same directory through an alias (a symlink, a Windows junction, a short 8.3-form
 * path, macOS's symlinked `os.tmpdir()`) has an unresolved `cwd` that never string-matches it —
 * `cwd`'s own worktree then shows up a second time in `worktrees[]` instead of being excluded.
 *
 * Built with a symlink/junction so this reproduces on **every** OS this suite runs on, Linux
 * included — CI had only caught it on windows-latest/macos-latest, exactly because neither `/tmp`
 * on a Linux runner nor this project's own Windows dev machine happened to hit either alias shape.
 * `src/adapters/git/canonical-path.ts` has the full account and the fix (`fs.realpath`).
 */
describe('GitAdapter.readFacts — cwd reached through an alias (symlink/junction), not the raw path', () => {
  it("does not duplicate cwd's own worktree in worktrees[] when cwd is aliased", async () => {
    fixture = await createGitFixture();
    await writeAndStage(fixture.mainDir, 'a.txt', 'hello\n');
    await commitAt(fixture.mainDir, YESTERDAY_10PM, 'chore: initial commit');
    await addWorktree(fixture, 'issue-42');

    const aliasedMainDir = await createAlias(fixture.mainDir, fixture.root, 'main-alias');
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readFacts(aliasedMainDir);

    if (!result.hasGit) {
      throw new Error('expected hasGit: true for a real repository');
    }
    // Before the fix: `worktrees` comes back with *two* entries here -- `issue-42` and cwd's own
    // main worktree, wrongly un-excluded because `path.resolve(aliasedMainDir)` never equals the
    // resolved path git itself reports for that same directory.
    expect(result.facts.worktrees).toHaveLength(1);
    const paths = result.facts.worktrees.map((w) => toPosix(w.path));
    expect(paths.some((p) => p.endsWith('/issue-42'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/main'))).toBe(false);
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

/**
 * D-032 (S4-T0): git evidence now follows `touchedFiles` instead of the session's launch `cwd`.
 * This is the suite's aceite test — "sessão lançada de fora de qualquer repositório, que tocou
 * arquivos em dois repositórios diferentes, produz handoff com os dois" — built against two real
 * repositories and a `cwd` that is neither of them, the same shape as the real capture that
 * motivated D-032 (`C:\code`, parent of `C:\code\see-you-tomorrow-ai`, `sources:
 * ["transcript","registry"]`, zero git facts).
 */
describe('GitAdapter.readEvidenceAcrossRepos — D-032', () => {
  let repoA: GitFixture;
  let repoB: GitFixture;
  let outsideDir: string;

  afterEach(async () => {
    await Promise.all([removeGitFixture(repoA), removeGitFixture(repoB)]);
    await rm(outsideDir, { recursive: true, force: true });
  });

  async function buildTwoRepos(): Promise<void> {
    repoA = await createGitFixture();
    await writeAndStage(repoA.mainDir, 'a.txt', 'frontend\n');
    await commitAt(repoA.mainDir, YESTERDAY_10PM, 'feat: frontend work');

    repoB = await createGitFixture();
    await writeAndStage(repoB.mainDir, 'b.txt', 'backend\n');
    await commitAt(repoB.mainDir, TODAY_9AM, 'feat: backend work');

    outsideDir = await mkdtemp(path.join(tmpdir(), 'seeya-git-outside-'));
  }

  it('a cwd outside any repository, with touched files in two repositories, reports both', async () => {
    await buildTwoRepos();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readEvidenceAcrossRepos(outsideDir, [
      path.join(repoA.mainDir, 'a.txt'),
      path.join(repoB.mainDir, 'b.txt'),
    ]);

    const roots = result.repositories.map((repo) => toPosix(repo.root)).sort();
    expect(roots).toEqual([toPosix(repoA.mainDir), toPosix(repoB.mainDir)].sort());
    expect(result.filesOutsideRepository).toBe(0);
    expect(result.reposNotVisited).toBe(0);
    const frontend = result.repositories.find(
      (repo) => toPosix(repo.root) === toPosix(repoA.mainDir),
    );
    expect(frontend?.commitsToday).toHaveLength(0); // dated yesterday
    const backend = result.repositories.find(
      (repo) => toPosix(repo.root) === toPosix(repoB.mainDir),
    );
    expect(backend?.commitsToday).toHaveLength(1);
  });

  it("the launch cwd's own repository is included even with no touched files inside it (D-032 rule 6)", async () => {
    await buildTwoRepos();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readEvidenceAcrossRepos(repoA.mainDir, [
      path.join(repoB.mainDir, 'b.txt'),
    ]);

    const roots = result.repositories.map((repo) => toPosix(repo.root));
    expect(roots).toContain(toPosix(repoA.mainDir));
    expect(roots).toContain(toPosix(repoB.mainDir));
  });

  it('a touched file outside every repository is counted, not silently dropped (D-025)', async () => {
    await buildTwoRepos();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });
    const outsideFile = path.join(outsideDir, 'notes.txt');

    const result = await adapter.readEvidenceAcrossRepos(outsideDir, [
      path.join(repoA.mainDir, 'a.txt'),
      outsideFile,
    ]);

    expect(result.filesOutsideRepository).toBe(1);
    expect(result.repositories).toHaveLength(1);
  });

  it('a cwd and touchedFiles all outside any repository report zero repositories, never a thrown error', async () => {
    await buildTwoRepos();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readEvidenceAcrossRepos(outsideDir, [
      path.join(outsideDir, 'a.txt'),
      path.join(outsideDir, 'b.txt'),
    ]);

    expect(result).toStrictEqual({
      repositories: [],
      filesOutsideRepository: 2,
      reposNotVisited: 0,
    });
  });

  it('the same root reached via cwd and via a touched file is not visited twice (normalize before dedup)', async () => {
    await buildTwoRepos();
    const adapter = new GitAdapter({ clock: new FakeClock(NOW) });

    const result = await adapter.readEvidenceAcrossRepos(repoA.mainDir, [
      path.join(repoA.mainDir, 'a.txt'),
    ]);

    expect(result.repositories).toHaveLength(1);
  });

  it(
    'more repositories than the visit ceiling: the excess is declared as reposNotVisited, never ' +
      'silently dropped (D-025) — cwd stays inside the ceiling either way (aceite rule 6)',
    async () => {
      await buildTwoRepos();
      const adapter = new GitAdapter({ clock: new FakeClock(NOW) });
      // maxRootsToVisit: 1 turns these two ordinary repositories into "more than the ceiling"
      // without building nine real repositories on disk just to reach the production default
      // (MAX_GIT_ROOTS_TO_VISIT) — see readEvidenceAcrossRepos's own docstring for why the limit
      // is an injectable parameter.
      const result = await adapter.readEvidenceAcrossRepos(
        repoA.mainDir,
        [path.join(repoB.mainDir, 'b.txt')],
        1,
      );

      expect(result.repositories).toHaveLength(1);
      expect(toPosix(result.repositories[0]!.root)).toBe(toPosix(repoA.mainDir));
      expect(result.reposNotVisited).toBe(1);
    },
  );
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
