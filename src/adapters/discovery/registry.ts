/**
 * The registry discovery strategy (D-016's first source, S1-T3): reads
 * `~/.claude/sessions/*.json`, validates item by item (D-022), excludes the caller's own forks
 * (D-012), resolves each record's transcript and liveness, and returns `SessionWithPid[]` — this
 * source's schema requires `pid`, so it can never produce `SessionWithoutPid` (that shape belongs
 * to the transcript-scan strategy, S1-T8).
 *
 * A bad `.json` file (corrupted text, missing required field) is reported and skipped, never
 * takes the batch down (D-022) — and neither does a directory-level failure worse than "doesn't
 * exist yet" (e.g. `sessions/` isn't actually a directory): reported the same way, as one
 * rejection, instead of throwing out of `discoverSessionsFromRegistry` and losing every session
 * the rest of the batch would otherwise have found. The two roots (`~/.claude`, `~/.seeya`) are
 * both injected parameters, never read from `os.homedir()`, so tests run entirely against a fake `tmpdir` and
 * this module never touches whoever runs it real `~/.claude` (AGENTS.md § "Regras que não se
 * negociam" — "Nunca leia, não grave... `~/.claude/` real").
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SessionWithPid } from '../../core/types.js';
import type { ProcessControl } from '../../core/ports.js';
import { sessionRecordSchema, type SessionRecord } from './schemas.js';
import { readForkRegistry, forkRejectionsAsRecords } from './fork-registry.js';
import { findTranscript } from './transcript-lookup.js';
import { buildSessionWithPid } from './session-mapping.js';
import { isEnoent } from './fs-errors.js';

export interface RegistryDiscoveryOptions {
  /** Injectable root standing in for `~/.claude` (never read from `os.homedir()` here). */
  readonly claudeHome: string;
  /** Injectable root standing in for `~/.seeya`, only used to find `forks.json` (D-012). */
  readonly seeyaHome: string;
  readonly processControl: ProcessControl;
}

/** One rejected `.json` file, with the raw value and the reason (AGENTS.md § "Mensagens de
 * erro" — always both), so `seeya sessions` can eventually say "N sessions, M entries ignored"
 * instead of lying by omission. */
export interface RejectedSessionRecord {
  readonly file: string;
  readonly raw: unknown;
  readonly reason: string;
}

export interface RegistryDiscoveryResult {
  readonly sessions: SessionWithPid[];
  readonly rejected: RejectedSessionRecord[];
}

/** Lists `sessionsDir`'s `.json` files. `.key` files (D-023's third strategy) are left alone —
 * they aren't this strategy's concern and are never even read, let alone parsed as JSON. A
 * missing directory (no session has ever registered on this machine) is empty, not an error. */
async function listSessionJsonFiles(sessionsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
  return entries.filter((name) => name.endsWith('.json'));
}

/** Wraps `listSessionJsonFiles` so a directory-level failure (not "missing", something worse —
 * e.g. the path isn't a directory at all) degrades to "found nothing, but say why", the same
 * shape as every per-file failure below, instead of throwing out of
 * `discoverSessionsFromRegistry` and losing every session the batch would otherwise have found. */
async function listSessionJsonFilesOrRejection(
  sessionsDir: string,
): Promise<string[] | RejectedSessionRecord> {
  try {
    return await listSessionJsonFiles(sessionsDir);
  } catch (error) {
    return {
      file: sessionsDir,
      raw: undefined,
      reason: `listing the sessions directory failed: ${String(error)}`,
    };
  }
}

/** Reads and validates one record file. Returns the parsed record, or (not throwing) the
 * rejection describing why it didn't parse — corrupted JSON and a schema failure both land here,
 * with the same shape, so the caller doesn't need to tell them apart. */
async function readAndValidateRecord(
  filePath: string,
): Promise<SessionRecord | RejectedSessionRecord> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    return { file: filePath, raw: undefined, reason: `reading failed: ${String(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { file: filePath, raw: text, reason: `not valid JSON: ${String(error)}` };
  }

  const result = sessionRecordSchema.safeParse(parsed);
  if (!result.success) {
    return { file: filePath, raw: parsed, reason: z.prettifyError(result.error) };
  }
  return result.data;
}

function isRejection(value: SessionRecord | RejectedSessionRecord): value is RejectedSessionRecord {
  return 'reason' in value;
}

type FileOutcome =
  | { readonly kind: 'accepted'; readonly session: SessionWithPid }
  | { readonly kind: 'rejected'; readonly rejection: RejectedSessionRecord }
  | { readonly kind: 'excluded' };

/**
 * Full per-file pipeline: parse+validate, exclude own forks, resolve liveness and transcript,
 * build the domain object. Wrapped in one `try`/`catch` so that *any* unexpected failure in this
 * record's own processing — not just a JSON/schema problem — is isolated as a rejection of this
 * one file rather than crashing `discoverSessionsFromRegistry`'s whole `Promise.all` (D-022's
 * guarantee applied to the entire per-record pipeline, not only to parsing).
 */
async function processSessionFile(
  filePath: string,
  projectsDir: string,
  knownForkSessionIds: ReadonlySet<string>,
  processControl: ProcessControl,
): Promise<FileOutcome> {
  try {
    const parsedOrRejection = await readAndValidateRecord(filePath);
    if (isRejection(parsedOrRejection)) {
      return { kind: 'rejected', rejection: parsedOrRejection };
    }
    const record = parsedOrRejection;
    if (knownForkSessionIds.has(record.sessionId)) {
      return { kind: 'excluded' };
    }

    const [processIsAlive, transcript] = await Promise.all([
      processControl.isAlive(record.pid, record.procStart),
      findTranscript(projectsDir, record.sessionId),
    ]);
    return {
      kind: 'accepted',
      session: buildSessionWithPid(record, { processIsAlive, ...transcript }),
    };
  } catch (error) {
    return {
      kind: 'rejected',
      rejection: { file: filePath, raw: undefined, reason: `discovery failed: ${String(error)}` },
    };
  }
}

export async function discoverSessionsFromRegistry(
  options: RegistryDiscoveryOptions,
): Promise<RegistryDiscoveryResult> {
  const sessionsDir = path.join(options.claudeHome, 'sessions');
  const projectsDir = path.join(options.claudeHome, 'projects');

  const [forkRegistry, fileNamesOrRejection] = await Promise.all([
    readForkRegistry(options.seeyaHome),
    listSessionJsonFilesOrRejection(sessionsDir),
  ]);
  const fileNames = Array.isArray(fileNamesOrRejection) ? fileNamesOrRejection : [];

  const outcomes = await Promise.all(
    fileNames.map((name) =>
      processSessionFile(
        path.join(sessionsDir, name),
        projectsDir,
        forkRegistry.sessionIds,
        options.processControl,
      ),
    ),
  );

  const sessions: SessionWithPid[] = [];
  const rejected = forkRejectionsAsRecords(options.seeyaHome, forkRegistry.rejected);
  if (!Array.isArray(fileNamesOrRejection)) {
    rejected.push(fileNamesOrRejection);
  }
  for (const outcome of outcomes) {
    if (outcome.kind === 'accepted') {
      sessions.push(outcome.session);
    } else if (outcome.kind === 'rejected') {
      rejected.push(outcome.rejection);
    }
  }

  return { sessions, rejected };
}
