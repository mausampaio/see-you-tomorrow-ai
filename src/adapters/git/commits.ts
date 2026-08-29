/**
 * "Commits do dia" (docs/ESPECIFICACAO.md § "Formato do handoff", `facts.git.commitsToday`).
 *
 * The filtering happens here, in TypeScript, against each commit's own committer timestamp — not
 * by handing `--since`/`--until` date words to git, because those are resolved against git's own
 * idea of "now" (the real system clock), not the `Clock` port this project injects everywhere
 * else (D-019). `--since=<cutoff>` below is only a coarse pre-filter, bounding how much history a
 * large repo has to walk; `cutoff` is itself derived from the injected `now`, one full day before
 * local midnight, wide enough to safely include every commit `isWithinLocalDay` will keep.
 *
 * Committer date (`%cI`, strict ISO-8601 with offset), not author date (`%aI`): a rebase or
 * cherry-pick can carry an old author date on a commit that was actually recorded today, and
 * "did work land today" is closer to what a handoff needs than "when was this change first
 * authored, possibly on another machine, possibly weeks ago". Not spelled out in
 * docs/ESPECIFICACAO.md — flagged in docs/QUESTOES.md for confirmation.
 */
import type { GitCommit } from '../../core/types.js';
import { runGit } from './run-git.js';
import { localDayBounds, isWithinLocalDay } from './local-day.js';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface CommitRecord {
  readonly sha: string;
  readonly title: string;
  readonly committedAt: Date;
}

/** One `git log` record back into its three fields, or `undefined` if it doesn't have exactly
 * three (defensive: this project controls the `--pretty=format:` string, so a malformed record
 * would mean the separators themselves collided with commit content, not ordinary bad input). */
function parseCommitRecord(record: string): CommitRecord | undefined {
  const [sha, committedAtIso, title] = record.split(FIELD_SEP);
  if (sha === undefined || committedAtIso === undefined || title === undefined) {
    return undefined;
  }
  return { sha, title, committedAt: new Date(committedAtIso) };
}

export function parseCommitLog(stdout: string): CommitRecord[] {
  return stdout
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map(parseCommitRecord)
    .filter((record): record is CommitRecord => record !== undefined);
}

/**
 * Never throws. Two different failure shapes both degrade to an empty list here, on purpose kept
 * as two separate checks rather than one combined condition, since each is independently
 * exercised by its own fixture (docs/TESTES.md's discipline of testing boundary values
 * explicitly): `!result.ran` is `git` never producing a real exit code at all (binary missing,
 * `workingDir` gone); `result.exitCode !== 0` is git running fine and reporting, in its own normal
 * way, that there is nothing to answer — most commonly exit 128, "does not have any commits yet",
 * on a brand-new branch. Neither is a sign the caller's directory is unreadable (that D-022
 * judgment, when it matters, is made one level up — see `git-adapter.ts#readWorktreeFacts` — by
 * checking a different command's `runGit` result directly).
 */
export async function readCommitsToday(workingDir: string, now: Date): Promise<GitCommit[]> {
  const bounds = localDayBounds(now);
  const cutoff = new Date(bounds.startOfToday.getTime() - ONE_DAY_MS);
  const format = `%h${FIELD_SEP}%cI${FIELD_SEP}%s${RECORD_SEP}`;
  const result = await runGit(workingDir, [
    'log',
    `--since=${cutoff.toISOString()}`,
    `--pretty=format:${format}`,
  ]);
  if (!result.ran) {
    return [];
  }
  if (result.exitCode !== 0) {
    return [];
  }
  return parseCommitLog(result.stdout)
    .filter((commit) => isWithinLocalDay(commit.committedAt, bounds))
    .map((commit) => ({ sha: commit.sha, title: commit.title }));
}
