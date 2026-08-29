/**
 * Builds a real git repository in `tmpdir` for `adapters/git`'s integration suite (docs/TESTES.md
 * § "git/": "repositório de teste construído em tmpdir com dois worktrees, um sujo e um limpo,
 * commits datados de hoje e de ontem"). Runs the real `git` binary — this is the one adapter
 * whose entire job is to shell out to it, so a fake would test nothing real.
 *
 * Identity (`GIT_AUTHOR_NAME`/`_EMAIL`, committer equivalents) and commit dates are always passed
 * as environment variables on the `git commit` call itself, never left to global/user git config
 * — the whole point (docs/TESTES.md's F.I.R.S.T: "independente") is that this suite must pass on
 * any machine, configured or not, and must place commits on exact, known instants rather than
 * whatever "now" the host happens to be at.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function run(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
      env,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git ${args.join(' ')} failed (exit ${code}) in ${cwd}: ${stderr}`));
      }
    });
  });
}

export interface GitFixture {
  readonly root: string;
  readonly mainDir: string;
}

export async function createGitFixture(): Promise<GitFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'seeya-git-'));
  const mainDir = path.join(root, 'main');
  await mkdir(mainDir, { recursive: true });
  await run(mainDir, ['init', '--initial-branch=main']);
  return { root, mainDir };
}

export async function removeGitFixture(fixture: GitFixture): Promise<void> {
  await rm(fixture.root, { recursive: true, force: true });
}

/** Writes `fileName` with `content` inside `dir` and stages it — a plain filesystem write, no
 * git call, kept separate from `commitAt` so a test can leave changes staged/unstaged to produce
 * a dirty tree instead of committing them. */
export async function writeAndStage(dir: string, fileName: string, content: string): Promise<void> {
  await writeFile(path.join(dir, fileName), content, 'utf8');
  await run(dir, ['add', '--', fileName]);
}

/**
 * Commits everything currently staged in `dir` at the exact instant `at` — both author and
 * committer date, via env vars (no reliance on git parsing a `--date` string the same way across
 * versions). `at.toISOString()` always carries an explicit `Z` offset, so the instant git records
 * is unambiguous regardless of the host machine's timezone.
 */
export async function commitAt(dir: string, at: Date, message: string): Promise<void> {
  const iso = at.toISOString();
  await run(dir, ['commit', '--message', message], {
    ...process.env,
    GIT_AUTHOR_NAME: 'Seeya Test',
    // Deliberately not shaped like a real address (no "at" sign): git never validates this
    // string, and an address-shaped value here would trip the repo's own pre-commit leak guard
    // (scripts/verificar-termos-locais.mjs's pattern has no allowlist for placeholder domains —
    // it flags that whole shape unconditionally, no exceptions).
    GIT_AUTHOR_EMAIL: 'seeya-test-fixture',
    GIT_COMMITTER_NAME: 'Seeya Test',
    GIT_COMMITTER_EMAIL: 'seeya-test-fixture',
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}

/** Adds a linked worktree at `<root>/<name>`, checked out on a new branch of the same name. */
export async function addWorktree(fixture: GitFixture, name: string): Promise<string> {
  const worktreeDir = path.join(fixture.root, name);
  await run(fixture.mainDir, ['worktree', 'add', '-b', name, worktreeDir]);
  return worktreeDir;
}
