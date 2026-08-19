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
 * independently (D-022) and only `sessionId` is required; every other field (`createdAt`, needed
 * by S2-T6's `forkCleanupDays`, or anything added later) is read and ignored here without
 * complaint (D-021 style) — this module only needs identity, never age.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isEnoent } from './fs-errors.js';

/** The root document shape (Q-008). `forks` stays `z.unknown()` per element on purpose: D-022
 * validates collection items one at a time, so a bad entry is reported and dropped instead of
 * failing this schema (and rejecting the whole file) the way `z.array(forkEntrySchema)` would. */
const forkRegistryFileSchema = z.object({
  schemaVersion: z.literal(1),
  forks: z.array(z.unknown()),
});

const forkEntrySchema = z.object({ sessionId: z.uuid() });

export interface RejectedForkEntry {
  readonly raw: unknown;
  readonly reason: string;
}

export interface ForkRegistryReadResult {
  readonly sessionIds: ReadonlySet<string>;
  readonly rejected: RejectedForkEntry[];
}

const EMPTY_RESULT: ForkRegistryReadResult = { sessionIds: new Set(), rejected: [] };

function singleRejection(raw: unknown, reason: string): ForkRegistryReadResult {
  return { sessionIds: new Set(), rejected: [{ raw, reason }] };
}

/** Reads the raw file text, or an already-final result for the two failure shapes that need no
 * further parsing: missing file (normal — no forks registered yet) and unreadable file. */
async function readForksFileText(forksPath: string): Promise<string | ForkRegistryReadResult> {
  try {
    return await readFile(forksPath, 'utf8');
  } catch (error) {
    if (isEnoent(error)) {
      return EMPTY_RESULT;
    }
    return singleRejection(undefined, `reading ${forksPath} failed: ${String(error)}`);
  }
}

/** Parses `text` as JSON and confirms the root document shape — `schemaVersion: 1` and a `forks`
 * array (Q-008) — the ways a whole file (not one entry) is rejected, since there's no per-item
 * boundary until this succeeds. A malformed or missing `schemaVersion` and a missing/non-array
 * `forks` can both be reported by the same `safeParse`, so a file broken in both ways gets one
 * rejection naming both problems instead of only the first one found. */
function parseForksJson(forksPath: string, text: string): unknown[] | ForkRegistryReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return singleRejection(text, `${forksPath} is not valid JSON: ${String(error)}`);
  }
  const result = forkRegistryFileSchema.safeParse(parsed);
  if (!result.success) {
    return singleRejection(parsed, `${forksPath}: ${z.prettifyError(result.error)}`);
  }
  return result.data.forks;
}

/** Validates each array entry independently (D-022 spirit): a bad entry doesn't drop the good
 * ones — this file is `seeya`'s own, but an interrupted write or a hand-edit can still corrupt it. */
function validateForkEntries(items: unknown[]): ForkRegistryReadResult {
  const sessionIds = new Set<string>();
  const rejected: RejectedForkEntry[] = [];
  for (const item of items) {
    const result = forkEntrySchema.safeParse(item);
    if (result.success) {
      sessionIds.add(result.data.sessionId);
    } else {
      rejected.push({ raw: item, reason: z.prettifyError(result.error) });
    }
  }
  return { sessionIds, rejected };
}

export async function readForkRegistry(seeyaHome: string): Promise<ForkRegistryReadResult> {
  const forksPath = path.join(seeyaHome, 'forks.json');
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
