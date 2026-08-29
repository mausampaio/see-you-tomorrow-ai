/**
 * Reads `<seeyaHome>/forks.json` — the registry of `sessionId`s of forks `seeya` itself created
 * via `--fork-session` (D-012). Discovery excludes them, or a fork gets discovered as a session,
 * captured, and forked again: a feedback loop.
 *
 * **Format fixed by Q-008 (docs/QUESTOES.md), answered option B**: a root object, not a bare
 * array, carrying `schemaVersion` like every other persisted document under `~/.seeya/`
 * (docs/ARQUITETURA.md § `storage/`: "schemaVersion em todo documento persistido, com migração
 * explícita") —
 *
 * ```jsonc
 * { "schemaVersion": 1, "forks": [{ "sessionId": "uuid-do-fork", "createdAt": "..." }] }
 * ```
 *
 * `schemaVersion` missing or not `1` is a visible whole-file rejection, same as `forks` missing
 * or not an array — none of that is silent. Each entry in `forks` is still validated
 * independently (D-022) and only `sessionId` is required; `createdAt` is optional here purely for
 * tolerance of a hand-edited or pre-S2-T2 entry missing it (D-021 style) — every entry
 * `adapters/generation` writes carries it (Q-008: needed by S2-T6's `forkCleanupDays`).
 *
 * **Two read functions, one shared parsing pipeline.** `readForkRegistry` (S1-T3's original
 * export, unchanged in shape or behavior) is what `registry.ts`/`transcript-scan.ts` use for
 * D-012's exclusion — it only needs identity, so it collapses entries to a `Set<sessionId>`.
 * `readForkRegistryEntries` (S2-T2) keeps each entry's full shape (`createdAt` included) — what
 * `adapters/generation`'s fork writer needs to merge a new fork into the existing list without
 * losing every other fork's recorded age. Exported from this module rather than duplicated
 * (AGENTS.md: "nada de duplicação") — the JSON-parse-then-validate pipeline (missing file, bad
 * JSON, wrong root shape, per-item validation) is the part worth sharing; `adapters/generation`
 * imports this file directly, the same way `adapters/transcript/` already imports straight from
 * sibling files in this directory (`transcript-lookup.ts`, `transcript-cwd.ts`) instead of going
 * through `index.ts`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isEnoent } from './fs-errors.js';

/** Current `schemaVersion` for `forks.json` (Q-008). Exported so the writer
 * (`adapters/generation/fork-registration.ts`) constructs the same value, never a hand-typed `1`
 * living in two places. */
export const FORK_REGISTRY_SCHEMA_VERSION = 1;

/** `<seeyaHome>/forks.json` — exported so the writer never re-derives this path on its own. */
export function forkRegistryPath(seeyaHome: string): string {
  return path.join(seeyaHome, 'forks.json');
}

/** The root document shape (Q-008). `forks` stays `z.unknown()` per element on purpose: D-022
 * validates collection items one at a time, so a bad entry is reported and dropped instead of
 * failing this schema (and rejecting the whole file) the way `z.array(forkEntrySchema)` would. */
const forkRegistryFileSchema = z.object({
  schemaVersion: z.literal(FORK_REGISTRY_SCHEMA_VERSION),
  forks: z.array(z.unknown()),
});

const forkEntrySchema = z.object({ sessionId: z.uuid(), createdAt: z.string().optional() });

/** One validated `forks[]` entry, `createdAt` included (Q-008). */
export type ForkRegistryEntry = z.infer<typeof forkEntrySchema>;

export interface RejectedForkEntry {
  readonly raw: unknown;
  readonly reason: string;
}

export interface ForkRegistryEntriesResult {
  readonly entries: ForkRegistryEntry[];
  readonly rejected: RejectedForkEntry[];
}

export interface ForkRegistryReadResult {
  readonly sessionIds: ReadonlySet<string>;
  readonly rejected: RejectedForkEntry[];
}

const EMPTY_ENTRIES_RESULT: ForkRegistryEntriesResult = { entries: [], rejected: [] };

function singleEntriesRejection(raw: unknown, reason: string): ForkRegistryEntriesResult {
  return { entries: [], rejected: [{ raw, reason }] };
}

/** Reads the raw file text, or an already-final result for the two failure shapes that need no
 * further parsing: missing file (normal — no forks registered yet) and unreadable file. */
async function readForksFileText(forksPath: string): Promise<string | ForkRegistryEntriesResult> {
  try {
    return await readFile(forksPath, 'utf8');
  } catch (error) {
    if (isEnoent(error)) {
      return EMPTY_ENTRIES_RESULT;
    }
    return singleEntriesRejection(undefined, `reading ${forksPath} failed: ${String(error)}`);
  }
}

/** Parses `text` as JSON and confirms the root document shape — `schemaVersion: 1` and a `forks`
 * array (Q-008) — the ways a whole file (not one entry) is rejected, since there's no per-item
 * boundary until this succeeds. A malformed or missing `schemaVersion` and a missing/non-array
 * `forks` can both be reported by the same `safeParse`, so a file broken in both ways gets one
 * rejection naming both problems instead of only the first one found. */
function parseForksJson(forksPath: string, text: string): unknown[] | ForkRegistryEntriesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return singleEntriesRejection(text, `${forksPath} is not valid JSON: ${String(error)}`);
  }
  const result = forkRegistryFileSchema.safeParse(parsed);
  if (!result.success) {
    return singleEntriesRejection(parsed, `${forksPath}: ${z.prettifyError(result.error)}`);
  }
  return result.data.forks;
}

/** Validates each array entry independently (D-022 spirit): a bad entry doesn't drop the good
 * ones — this file is `seeya`'s own, but an interrupted write or a hand-edit can still corrupt it. */
function validateForkEntries(items: unknown[]): ForkRegistryEntriesResult {
  const entries: ForkRegistryEntry[] = [];
  const rejected: RejectedForkEntry[] = [];
  for (const item of items) {
    const result = forkEntrySchema.safeParse(item);
    if (result.success) {
      entries.push(result.data);
    } else {
      rejected.push({ raw: item, reason: z.prettifyError(result.error) });
    }
  }
  return { entries, rejected };
}

/** Full `forks[]` entries (`createdAt` included), for a caller that needs to preserve every
 * existing entry — S2-T2's fork writer, merging a new fork in without dropping the others' age. */
export async function readForkRegistryEntries(
  seeyaHome: string,
): Promise<ForkRegistryEntriesResult> {
  const forksPath = forkRegistryPath(seeyaHome);
  const textOrResult = await readForksFileText(forksPath);
  if (typeof textOrResult !== 'string') {
    return textOrResult;
  }
  const itemsOrResult = parseForksJson(forksPath, textOrResult);
  if (!Array.isArray(itemsOrResult)) {
    return itemsOrResult;
  }
  return validateForkEntries(itemsOrResult);
}

/** Identity only (`sessionId` set), for D-012's exclusion — `registry.ts`/`transcript-scan.ts`'s
 * original S1-T3 contract, unchanged. */
export async function readForkRegistry(seeyaHome: string): Promise<ForkRegistryReadResult> {
  const { entries, rejected } = await readForkRegistryEntries(seeyaHome);
  return { sessionIds: new Set(entries.map((entry) => entry.sessionId)), rejected };
}

/** One rejected external record, in the shape every discovery strategy in this adapter reports
 * rejections with (`registry.ts`'s `RejectedSessionRecord`, `transcript-scan.ts`'s
 * `RejectedTranscriptRecord`): the file it came from, the raw value, and why it was rejected. */
export interface RejectedExternalRecord {
  readonly file: string;
  readonly raw: unknown;
  readonly reason: string;
}

/**
 * Turns `readForkRegistry`'s own rejections into the caller's generic `{file, raw, reason}`
 * rejection shape, tagged with `forks.json`'s own path — every discovery strategy that excludes
 * forks (D-012) needs this, so it lives here once instead of once per strategy (AGENTS.md: "nada
 * de duplicação"). Both `registry.ts` (S1-T3) and `transcript-scan.ts` (S1-T8) call this on the
 * `rejected` side of `readForkRegistry`'s result; the caller's own rejection type is structurally
 * identical to `RejectedExternalRecord`, so no cast is needed at either call site.
 */
export function forkRejectionsAsRecords(
  seeyaHome: string,
  forkRejected: readonly RejectedForkEntry[],
): RejectedExternalRecord[] {
  const file = forkRegistryPath(seeyaHome);
  return forkRejected.map((entry) => ({
    file,
    raw: entry.raw,
    reason: `fork registry entry ignored: ${entry.reason}`,
  }));
}
