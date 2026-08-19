/**
 * Reads `<seeyaHome>/forks.json` — the registry of `sessionId`s of forks `seeya` itself created
 * via `--fork-session` (D-012). Discovery excludes them, or a fork gets discovered as a session,
 * captured, and forked again: a feedback loop.
 *
 * **The file's format is not fixed by any task before this one.** D-012 only says "every fork
 * `sessionId` is registered" — it doesn't specify the shape, and no task before S1-T3 writes this
 * file (S2-T2 is the writer, S2-T6 the cleanup reader that needs `forkCleanupDays` age). This
 * module commits to the minimal shape D-012's exclusion actually needs — a JSON array of objects
 * each carrying at least `sessionId` — validated item by item and tolerant of unknown fields
 * (D-021 style), so S2-T2 can add `createdAt` later without breaking this reader. Flagged in
 * docs/QUESTOES.md Q-008 so S1-T5/S2-T2 confirm or correct the shape before any real forks.json
 * exists on disk (D-027's own closing principle: this kind of decision is cheap before the first
 * byte is written and expensive after).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isEnoent } from './fs-errors.js';

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

/** Parses `text` as JSON and confirms it's an array — the two ways a whole file (not one entry)
 * is rejected, since there's no per-item boundary until this succeeds. */
function parseForksJson(forksPath: string, text: string): unknown[] | ForkRegistryReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return singleRejection(text, `${forksPath} is not valid JSON: ${String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    return singleRejection(parsed, `${forksPath} must be a JSON array, got ${typeof parsed}`);
  }
  // `Array.isArray`'s built-in type predicate narrows to `any[]`, not `unknown[]` — a known gap
  // in lib.es5.d.ts, not a sign this code doesn't know its own types. `parsed` was `unknown`
  // right up to this line; validateForkEntries immediately re-validates every element with zod,
  // so nothing downstream trusts this cast to mean more than "it's an array".
  return parsed as unknown[];
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
