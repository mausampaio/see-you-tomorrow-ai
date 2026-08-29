/**
 * `GitReader`'s concrete implementation (S2-T1, `core/ports.ts`). D-013's first and most reliable
 * evidence source: branch, dirty status, today's commits, and the state of every *other* worktree
 * of the same repository — the last one matters more than it looks (docs/ARQUITETURA.md § `git/`
 * and the task that requested this file): a session whose real work happened in a linked worktree
 * beside `cwd`, with no transcript at all, still gets a useful handoff only if this adapter looks
 * there too.
 */
import path from 'node:path';
import type { Clock, GitReader, GitReadResult, RejectedDiscoveryRecord } from '../../core/ports.js';
import type { WorktreeFacts } from '../../core/types.js';
import { isInsideWorkTree } from './repo.js';
import { readBranch } from './branch.js';
import { readModifiedFiles, parseStatusPorcelain } from './status.js';
import { readCommitsToday } from './commits.js';
import { runGit } from './run-git.js';
import { parseWorktreeListPorcelain, type WorktreeListEntry } from './worktree-list.js';

/** Absolute, comparable form of a git-reported or caller-given path — case-insensitive on
 * Windows, where the same worktree can be spelled with different casing across the two sources. */
function normalize(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

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
    commitsToday: commitsToday.length,
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

async function listOtherWorktrees(cwd: string): Promise<WorktreeListEntry[]> {
  const result = await runGit(cwd, ['worktree', 'list', '--porcelain']);
  if (!result.ran || result.exitCode !== 0) {
    return [];
  }
  const ownPath = normalize(cwd);
  return parseWorktreeListPorcelain(result.stdout).filter(
    (entry) => normalize(entry.path) !== ownPath,
  );
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
}
