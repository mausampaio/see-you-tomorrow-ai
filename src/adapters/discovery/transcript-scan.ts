/**
 * The transcript-scan discovery strategy (D-016's second source, S1-T8): walks
 * `~/.claude/projects/<slug>/*.jsonl` (one level, deliberately not recursive) ``, keeps only files whose mtime falls inside `relevanceHours`,
 * and reconstructs a session from each survivor's content — never from the directory slug, which
 * D-016 already established is derived from `cwd` but not safely reversible.
 *
 * This is the strategy the Spike D finding motivates directly: a headless session (`claude -p`)
 * writes a transcript but never registers in `~/.claude/sessions/` (docs/spikes/D-*.md), so the
 * registry strategy (S1-T3, `registry.ts`) is structurally blind to it. Every session this module
 * finds is a `SessionWithoutPid` — `hasPid: false` — because a `.jsonl` file alone never carries a
 * PID; that's D-016's own framing ("nunca é candidata a encerramento de processo", D-002) and it's
 * enforced by the type, not by a comment (D-024): there is no `pid` field to accidentally read.
 *
 * **The mtime filter has to run before any file is opened.** `stat` is cheap; parsing hundreds of
 * `.jsonl` files that turn out to be irrelevant is not, and the gap is exactly what a machine with
 * a large `~/.claude` history pays for if this module got it backwards. `collectCandidateFiles`
 * below only lists names and directory shape; `stat`ing each candidate for its mtime, and skipping
 * it before ever calling `readCwdFromTranscript`, is what `discoverSessionsFromTranscriptScan`
 * itself does, file by file.
 *
 * The scan sees every fork `seeya` itself created via `--fork-session` (D-012) — `--fork-session`
 * copies the whole transcript into a new `.jsonl` under `~/.claude/projects/`, so unlike the
 * registry strategy (which rarely even sees a fork, since forks are usually headless too), this
 * strategy sees *all* of them. Excluding `forks.json` entries here isn't hygiene, it's what stops
 * `seeya` from discovering its own forks, capturing them, and forking again — the feedback loop
 * D-012 exists to prevent. `fork-registry.ts` is reused as-is (same module S1-T3 wrote), never
 * duplicated.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SessionWithoutPid } from '../../core/types.js';
import { readForkRegistry, forkRejectionsAsRecords } from './fork-registry.js';
import { readCwdFromTranscript } from './transcript-cwd.js';
import { deriveNameFromCwd } from './session-mapping.js';
import { isEnoent } from './fs-errors.js';

/**
 * **Why this walk stops at one level, even though D-016 used to write the glob with `**`.**
 * Observed on 2026-08-29, running the first real `seeya sessions`: a session directory can
 * itself hold a subdirectory named after a session id, containing that session's sub-agent
 * transcripts. Those are not sessions — they belong to the parent, which is discovered
 * normally and has a transcript of its own.
 *
 * Recursing would turn every sub-agent run into a phantom headless session: no registry entry,
 * so it looks exactly like the case D-016 built this strategy for, and each would earn its own
 * handoff. Measured at that moment: 7 recent transcripts on the machine — 1 a real session, 6
 * belonging to sub-agents of it.
 *
 * The `**` in D-016 was loose writing, not a requirement, and is corrected there. If you came
 * here to make this walk match a `**` glob you read somewhere, this comment is the reason not
 * to.
 */
const TRANSCRIPT_EXTENSION = '.jsonl';
const MS_PER_HOUR = 3_600_000;

/** The Claude Code session UUID, same requirement `registry.ts`'s `sessionRecordSchema` places on
 * the field of the same name — here it comes from the file name instead of a JSON field, but it's
 * the identical piece of external data and the identical shape requirement. */
const transcriptSessionIdSchema = z.uuid();

export interface TranscriptScanOptions {
  /** Injectable root standing in for `~/.claude` (never read from `os.homedir()` here). */
  readonly claudeHome: string;
  /** Injectable root standing in for `~/.seeya`, only used to find `forks.json` (D-012). */
  readonly seeyaHome: string;
  /** The current instant, obtained from the `Clock` port by the caller — never read here (D-019). */
  readonly now: Date;
  /** `relevanceHours` from `config.json` (default 12h, docs/ARQUITETURA.md § Config). A file whose
   * mtime falls outside this window is skipped before it's ever opened — see the module docstring. */
  readonly relevanceHours: number;
}

/** One rejected transcript, with the raw value and the reason (AGENTS.md § "Mensagens de erro" —
 * always both), so `seeya sessions` can eventually say "N sessions, M entries ignored" instead of
 * lying by omission. Structurally identical to `registry.ts`'s `RejectedSessionRecord` — both are
 * `fork-registry.ts`'s shared `RejectedExternalRecord` shape, kept as separate named types per
 * strategy so each module documents its own field on its own terms. */
export interface RejectedTranscriptRecord {
  readonly file: string;
  readonly raw: unknown;
  readonly reason: string;
}

export interface TranscriptScanResult {
  readonly sessions: SessionWithoutPid[];
  readonly rejected: RejectedTranscriptRecord[];
}

/** Lists the `.jsonl` files directly under one project slug directory (one level deep — the real
 * layout never nests further, same assumption `transcript-lookup.ts` makes). A slug entry that
 * isn't actually a directory (stray file, permission problem) is reported as one rejection for
 * that slug and doesn't stop the other slugs from being scanned (D-022). */
async function listSlugTranscripts(slugDir: string): Promise<string[] | RejectedTranscriptRecord> {
  let entries: string[];
  try {
    entries = await readdir(slugDir);
  } catch (error) {
    return {
      file: slugDir,
      raw: undefined,
      reason: `listing slug directory failed: ${String(error)}`,
    };
  }
  return entries
    .filter((name) => name.endsWith(TRANSCRIPT_EXTENSION))
    .map((name) => path.join(slugDir, name));
}

/** Lists every `.jsonl` under `projectsDir`, across every slug. A missing `projectsDir` (no
 * transcript has ever been written on this machine) is the normal empty case, not an error —
 * same treatment `transcript-lookup.ts` and `registry.ts` give their own missing directories. */
async function collectCandidateFiles(
  projectsDir: string,
): Promise<{ readonly files: string[]; readonly rejected: RejectedTranscriptRecord[] }> {
  let slugs: string[];
  try {
    slugs = await readdir(projectsDir);
  } catch (error) {
    if (isEnoent(error)) {
      return { files: [], rejected: [] };
    }
    return {
      files: [],
      rejected: [
        {
          file: projectsDir,
          raw: undefined,
          reason: `listing the projects directory failed: ${String(error)}`,
        },
      ],
    };
  }

  const perSlug = await Promise.all(
    slugs.map((slug) => listSlugTranscripts(path.join(projectsDir, slug))),
  );

  const files: string[] = [];
  const rejected: RejectedTranscriptRecord[] = [];
  for (const result of perSlug) {
    if (Array.isArray(result)) {
      files.push(...result);
    } else {
      rejected.push(result);
    }
  }
  return { files, rejected };
}

/** `stat`s one candidate for its mtime — the only thing read before the relevance-window decision
 * is made. A failure here (permission denied, file removed between listing and this call) is a
 * per-file rejection, never a crash and never a silent "skip" that would look identical to a file
 * legitimately outside the window (D-025: "couldn't check" isn't the same claim as "too old"). */
async function statMtimeMs(filePath: string): Promise<number | RejectedTranscriptRecord> {
  try {
    const stats = await stat(filePath);
    return stats.mtimeMs;
  } catch (error) {
    return { file: filePath, raw: undefined, reason: `stat failed: ${String(error)}` };
  }
}

type FileOutcome =
  | { readonly kind: 'accepted'; readonly session: SessionWithoutPid }
  | { readonly kind: 'rejected'; readonly rejection: RejectedTranscriptRecord }
  | { readonly kind: 'excluded' };

/**
 * Full per-file pipeline for a candidate already confirmed to be inside the relevance window:
 * validate the session id from the file name, exclude known forks (D-012, cheaper than opening the
 * file — a fork's transcript is a full copy of the original and can be just as large), then read
 * `cwd` from content and assemble the `SessionWithoutPid`. Wrapped in one `try`/`catch` so *any*
 * unexpected failure here is isolated as this file's own rejection, never crashing the whole batch
 * (same guarantee `registry.ts#processSessionFile` gives for its strategy).
 */
async function processTranscriptFile(
  filePath: string,
  mtimeMs: number,
  knownForkSessionIds: ReadonlySet<string>,
): Promise<FileOutcome> {
  try {
    const fileName = path.basename(filePath);
    const candidateId = fileName.slice(0, -TRANSCRIPT_EXTENSION.length);
    const idResult = transcriptSessionIdSchema.safeParse(candidateId);
    if (!idResult.success) {
      return {
        kind: 'rejected',
        rejection: {
          file: filePath,
          raw: fileName,
          reason: `file name is not a valid session id: ${z.prettifyError(idResult.error)}`,
        },
      };
    }
    const sessionId = idResult.data;
    if (knownForkSessionIds.has(sessionId)) {
      return { kind: 'excluded' };
    }

    const { cwd } = await readCwdFromTranscript(filePath);
    if (cwd === null) {
      return {
        kind: 'rejected',
        rejection: {
          file: filePath,
          raw: undefined,
          reason: 'no line in the transcript carried a readable cwd before end of file',
        },
      };
    }

    const lastActivity = new Date(mtimeMs);
    return {
      kind: 'accepted',
      session: {
        hasPid: false,
        sessionId,
        cwd,
        name: deriveNameFromCwd(cwd),
        hasTranscript: true,
        lastTranscriptWrite: lastActivity,
        lastActivity,
      },
    };
  } catch (error) {
    return {
      kind: 'rejected',
      rejection: { file: filePath, raw: undefined, reason: `discovery failed: ${String(error)}` },
    };
  }
}

/**
 * The transcript-scan strategy's entry point (D-016, S1-T8). Returns every session found only by
 * scanning transcripts — headless sessions the registry strategy never sees — as
 * `SessionWithoutPid`, plus every rejection encountered along the way (D-022's both-sides
 * contract). Merging this with `discoverSessionsFromRegistry`'s output into one deduplicated list
 * is S1-T9's job, not this function's: this module doesn't know the registry strategy exists.
 */
export async function discoverSessionsFromTranscriptScan(
  options: TranscriptScanOptions,
): Promise<TranscriptScanResult> {
  const projectsDir = path.join(options.claudeHome, 'projects');
  const cutoffMs = options.now.getTime() - options.relevanceHours * MS_PER_HOUR;

  const [forkRegistry, candidates] = await Promise.all([
    readForkRegistry(options.seeyaHome),
    collectCandidateFiles(projectsDir),
  ]);

  const rejected: RejectedTranscriptRecord[] = [
    ...forkRejectionsAsRecords(options.seeyaHome, forkRegistry.rejected),
    ...candidates.rejected,
  ];

  const outcomes = await Promise.all(
    candidates.files.map(async (filePath): Promise<FileOutcome | { readonly kind: 'skipped' }> => {
      const mtimeOrRejection = await statMtimeMs(filePath);
      if (typeof mtimeOrRejection !== 'number') {
        return { kind: 'rejected', rejection: mtimeOrRejection };
      }
      // Outside the relevance window: never opened. This is the normal, expected outcome for most
      // files on a machine with any real history — not a rejection, just not relevant right now.
      if (mtimeOrRejection < cutoffMs) {
        return { kind: 'skipped' };
      }
      return processTranscriptFile(filePath, mtimeOrRejection, forkRegistry.sessionIds);
    }),
  );

  const sessions: SessionWithoutPid[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === 'accepted') {
      sessions.push(outcome.session);
    } else if (outcome.kind === 'rejected') {
      rejected.push(outcome.rejection);
    }
  }

  return { sessions, rejected };
}
