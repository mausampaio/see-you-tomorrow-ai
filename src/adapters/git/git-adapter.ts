/**
 * `GitReader`'s concrete implementation (S2-T1, `core/ports.ts`). D-013's first and most reliable
 * evidence source: branch, dirty status, today's commits, and the state of every *other* worktree
 * of the same repository — the last one matters more than it looks (docs/ARQUITETURA.md § `git/`
 * and the task that requested this file): a session whose real work happened in a linked worktree
 * beside `cwd`, with no transcript at all, still gets a useful handoff only if this adapter looks
 * there too.
 */
import type {
  Clock,
  GitEvidenceAcrossRepos,
  GitReader,
  GitReadResult,
  RejectedDiscoveryRecord,
} from '../../core/ports.js';
import type { RepositoryGitFacts, WorktreeFacts } from '../../core/types.js';
import { normalizeCwdForComparison, type PathPlatformHint } from '../../core/cwd-normalization.js';
import { isInsideWorkTree } from './repo.js';
import { readBranch } from './branch.js';
import { readModifiedFiles, parseStatusPorcelain } from './status.js';
import { readCommitsToday } from './commits.js';
import { runGit } from './run-git.js';
import { parseWorktreeListPorcelain, type WorktreeListEntry } from './worktree-list.js';
import { canonicalPath, sameCanonicalPath } from './canonical-path.js';
import { findRepoRoot } from './repo-roots.js';

/**
 * Unlike the main `cwd` path (which uses `readModifiedFiles`, graceful on any failure, D-025),
 * this calls `runGit` directly and inspects `ran` itself — `readModifiedFiles`/`readBranch`
 * deliberately hide that distinction (their docstrings say so), because *this* is the one place
 * in the adapter that needs it: `ran: false` here means `git worktree list` still remembers a
 * directory that's gone from disk, and that has to surface as a rejection (D-022), not as a quiet
 * "0 commits, not dirty" that would misrepresent a worktree nobody can actually read.
 */
async function readWorktreeFacts(entry: WorktreeListEntry, now: Date): Promise<WorktreeFacts> {
  const statusResult = await runGit(entry.path, ['status', '--porcelain=v1']);
  if (!statusResult.ran) {
    throw new Error(`worktree at "${entry.path}" is not reachable: ${statusResult.reason}`);
  }
  const modifiedFiles =
    statusResult.exitCode === 0 ? parseStatusPorcelain(statusResult.stdout) : [];
  const commitsToday = await readCommitsToday(entry.path, now);
  return {
    path: entry.path,
    branch: entry.branch,
    dirty: modifiedFiles.length > 0,
    commitsTodayCount: commitsToday.length,
  };
}

type WorktreeOutcome =
  | { readonly kind: 'accepted'; readonly facts: WorktreeFacts }
  | { readonly kind: 'rejected'; readonly rejection: RejectedDiscoveryRecord };

/** One worktree's own failure (D-022) — most commonly `git worktree list` still remembering a
 * directory that's gone from disk — never takes down the rest of the enumeration. */
async function readWorktreeOrRejection(
  entry: WorktreeListEntry,
  now: Date,
): Promise<WorktreeOutcome> {
  try {
    return { kind: 'accepted', facts: await readWorktreeFacts(entry, now) };
  } catch (error) {
    return {
      kind: 'rejected',
      rejection: {
        file: entry.path,
        raw: entry,
        reason: `reading worktree failed: ${String(error)}`,
      },
    };
  }
}

/**
 * Excludes `cwd`'s own entry from `git worktree list`'s output by *canonical* path
 * (`canonical-path.ts`), not by the raw strings the two sources happen to spell it with — see
 * that module for the production bug (symlinked tmpdir on macOS, short-path form on Windows) this
 * exists to fix. An entry whose path can't be canonicalized (most commonly: deleted from disk) is
 * never excluded here — it's kept, and flows to `readWorktreeOrRejection` below, which is where
 * that failure becomes a visible D-022 rejection instead of silently vanishing from the list.
 */
async function listOtherWorktrees(cwd: string): Promise<WorktreeListEntry[]> {
  const result = await runGit(cwd, ['worktree', 'list', '--porcelain']);
  if (!result.ran || result.exitCode !== 0) {
    return [];
  }
  const entries = parseWorktreeListPorcelain(result.stdout);
  const ownPath = await canonicalPath(cwd);
  const withCanonicalPaths = await Promise.all(
    entries.map(async (entry) => ({ entry, canonical: await canonicalPath(entry.path) })),
  );
  return withCanonicalPaths
    .filter((item) => !sameCanonicalPath(item.canonical, ownPath))
    .map((item) => item.entry);
}

async function readWorktrees(
  cwd: string,
  now: Date,
): Promise<{ worktrees: WorktreeFacts[]; rejectedWorktrees: RejectedDiscoveryRecord[] }> {
  const entries = await listOtherWorktrees(cwd);
  const outcomes = await Promise.all(entries.map((entry) => readWorktreeOrRejection(entry, now)));
  const worktrees: WorktreeFacts[] = [];
  const rejectedWorktrees: RejectedDiscoveryRecord[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === 'accepted') {
      worktrees.push(outcome.facts);
    } else {
      rejectedWorktrees.push(outcome.rejection);
    }
  }
  return { worktrees, rejectedWorktrees };
}

/** Read once, same pattern `application/eligibility-assembly.ts`/`cli/session-reference.ts`
 * already use for `core/cwd-normalization.ts` (S3-T5): the function itself stays pure and platform
 * is a parameter, the real `process.platform` is only ever read here, at the one call site. */
const PLATFORM_HINT: PathPlatformHint = process.platform === 'win32' ? 'win32' : 'posix';

/**
 * E/S ceiling, not product judgment (D-032's own text: "rotulado no código como E/S e não
 * julgamento de produto" — the same distinction docs/QUESTOES.md Q-025 already drew for
 * `MAX_BRIEFING_SCAN_DAYS`, and exported the same way that constant is, for the same reason: a
 * test proving the ceiling is respected shouldn't need to build 9 real repositories on disk when
 * it can pass a smaller limit instead). Each visited root costs several `git` subprocess calls
 * (`readFacts` below spawns branch/status/commits/worktree-list, plus a status+commits pair per
 * worktree it finds) — a session touching two or three repositories (frontend + backend, the
 * common case D-032 exists for) stays well inside this; the excess beyond it is counted in
 * `reposNotVisited`, never silently dropped (D-025).
 */
export const MAX_GIT_ROOTS_TO_VISIT = 8;

/** Adds `root` to `roots` unless it's `null` or already present under `core/cwd-normalization.ts`'s
 * comparison key — first-seen raw spelling wins and is what's kept (for `readFacts`/display), only
 * the KEY used to detect a duplicate is normalized (D-032: "normalizar a raiz antes de
 * desduplicar", reusing S3-T5 rather than reimplementing it). */
function addUniqueRoot(roots: string[], seenKeys: Set<string>, root: string | null): void {
  if (root === null) {
    return;
  }
  const key = normalizeCwdForComparison(root, PLATFORM_HINT);
  if (seenKeys.has(key)) {
    return;
  }
  seenKeys.add(key);
  roots.push(root);
}

/**
 * Every distinct repository root among `cwd` and `touchedFiles` (D-032), `cwd`'s own root always
 * first — so it's never the entry dropped by `MAX_GIT_ROOTS_TO_VISIT` when a session touches more
 * repositories than the ceiling allows (docs/PLANO-DE-ENTREGA.md S4-T0: "o `cwd` de lançamento
 * continua valendo quando for repositório").
 */
async function discoverRootsToVisit(
  cwd: string,
  touchedFiles: readonly string[],
): Promise<{ readonly roots: string[]; readonly filesOutsideRepository: number }> {
  const [cwdRoot, ...fileRoots] = await Promise.all([
    findRepoRoot(cwd),
    ...touchedFiles.map((file) => findRepoRoot(file)),
  ]);
  const filesOutsideRepository = fileRoots.filter((root) => root === null).length;

  const roots: string[] = [];
  const seenKeys = new Set<string>();
  addUniqueRoot(roots, seenKeys, cwdRoot);
  for (const root of fileRoots) {
    addUniqueRoot(roots, seenKeys, root);
  }
  return { roots, filesOutsideRepository };
}

export interface GitAdapterOptions {
  /** The project's single source of "now" (D-019) — read once per `readFacts` call, resolving
   * "commits do dia" against the local calendar day at the moment of the call. */
  readonly clock: Clock;
}

export class GitAdapter implements GitReader {
  constructor(private readonly options: GitAdapterOptions) {}

  async readFacts(cwd: string): Promise<GitReadResult> {
    const hasGit = await isInsideWorkTree(cwd);
    if (!hasGit) {
      return { hasGit: false };
    }

    const now = this.options.clock.now();
    // `readBranch`/`readModifiedFiles`/`readCommitsToday` are all graceful by construction (never
    // throw, D-025) — a TOCTOU race where `cwd` disappears right after `isInsideWorkTree` just
    // degrades the affected field to its least-specific value on its own. `readWorktrees` handles
    // its own per-item failures separately (D-022) and never throws either.
    const [branch, modifiedFiles, commitsToday, worktreeData] = await Promise.all([
      readBranch(cwd),
      readModifiedFiles(cwd),
      readCommitsToday(cwd, now),
      readWorktrees(cwd, now),
    ]);

    return {
      hasGit: true,
      facts: {
        branch,
        dirty: modifiedFiles.length > 0,
        modifiedFiles,
        commitsToday,
        worktrees: worktreeData.worktrees,
      },
      rejectedWorktrees: worktreeData.rejectedWorktrees,
    };
  }

  /**
   * D-032: `readFacts` above answers for a single, caller-supplied `cwd` only — this answers for
   * every repository a session actually touched, deriving candidate roots from `touchedFiles`
   * instead of assuming the launch `cwd` is where the work happened (see this port method's own
   * docstring in `core/ports.ts`).
   *
   * `maxRootsToVisit` defaults to `MAX_GIT_ROOTS_TO_VISIT` and exists as a parameter (not read
   * from a module constant directly) for the exact reason `application/find-pending-briefing.ts
   * #findPendingBriefing` already takes `maxScanDays` as a parameter: a test proving the ceiling
   * is respected can pass a small number instead of building enough real repositories on disk to
   * reach the production default. Every real caller (`application/evidence-gathering.ts`) uses the
   * two-argument form and gets the real ceiling.
   */
  async readEvidenceAcrossRepos(
    cwd: string,
    touchedFiles: readonly string[],
    maxRootsToVisit: number = MAX_GIT_ROOTS_TO_VISIT,
  ): Promise<GitEvidenceAcrossRepos> {
    const { roots, filesOutsideRepository } = await discoverRootsToVisit(cwd, touchedFiles);
    const toVisit = roots.slice(0, maxRootsToVisit);
    const reposNotVisited = roots.length - toVisit.length;

    const results = await Promise.all(toVisit.map((root) => this.readFacts(root)));
    const repositories: RepositoryGitFacts[] = [];
    results.forEach((result, index) => {
      if (result.hasGit) {
        repositories.push({ root: toVisit[index]!, ...result.facts });
      }
      // A `.git` entry existing but `readFacts` answering `hasGit: false` would be surprising —
      // `findRepoRoot` and `isInsideWorkTree` trust the same marker — but tolerated rather than
      // assumed impossible (D-025): the root is simply not counted as a repository, no error
      // raised and the other roots are unaffected.
    });

    return { repositories, filesOutsideRepository, reposNotVisited };
  }
}
