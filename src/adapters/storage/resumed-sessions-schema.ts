/**
 * `~/.seeya/days/<day>/resumed.json`'s shape — `Storage.readResumedSessionIds`/
 * `saveResumedSessionIds`'s on-disk form (S3-T3, `core/ports.ts`'s own docstring has the full
 * reasoning for why this is per-day, per-SESSION bookkeeping rather than a single "day resumed"
 * flag).
 *
 * New disk identifiers (`resumed.json`, `sessionIds`), not yet in AGENTS.md § "Idioma"'s
 * "Identificadores que vão para disco" table — flagged in docs/QUESTOES.md for the PO to fold in,
 * same non-blocking pattern S1-T7 already used for `early-warnings.json`.
 *
 * Same corruption policy as `early-warning-schema.ts`/`config-schema.ts`: a missing file means "no
 * session resumed yet for this day" (D-025), never an error; a present-but-malformed file rejects
 * loudly rather than silently reading back as "nothing resumed".
 *
 * **Not validated item-by-item (D-022).** Same reasoning `early-warning-schema.ts` already gives
 * for its own two sets: every entry here was written by `StorageAdapter#saveResumedSessionIds`
 * itself, never an external, unfamiliar source — a malformed entry means the file was corrupted or
 * hand-edited, not that an unfamiliar format arrived from outside.
 */
import { z } from 'zod';

/** Current `schemaVersion` for `resumed.json`. Passed to `resolveSchemaVersion` by the adapter
 * (`index.ts`) before this module ever sees the document. */
export const RESUMED_SESSIONS_SCHEMA_VERSION = 1;

/**
 * Validates everything BUT `schemaVersion` — by the time this runs, `resolveSchemaVersion` has
 * already confirmed the document is at `RESUMED_SESSIONS_SCHEMA_VERSION`. No `.strict()`: an
 * unrecognized top-level key is ignored rather than failing the whole file, same tolerance every
 * other schema in this project gives to a future field (D-021's spirit).
 */
const resumedSessionsDocumentSchema = z.object({
  sessionIds: z.array(z.string()).optional(),
});

/**
 * Parses `raw` (the document, already past `resolveSchemaVersion`) into the resumed-`sessionId`
 * set. `sessionIds` absent (but the file present, e.g. `{ "schemaVersion": 1 }`) resolves to an
 * empty set — the file existing at all with the field omitted is normal, not corruption.
 */
export function parseResumedSessionsDocument(raw: unknown): ReadonlySet<string> {
  const result = resumedSessionsDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`resumed.json is malformed: ${z.prettifyError(result.error)}`);
  }
  return new Set(result.data.sessionIds ?? []);
}

/**
 * The inverse of `parseResumedSessionsDocument` — what `StorageAdapter#saveResumedSessionIds`
 * writes. A `Set` has no stable JSON form of its own, so this is the one place that picks the
 * array order (insertion order, `Set`'s own iteration order) — irrelevant to every reader, which
 * only ever calls `.has()` on the set built back from it.
 */
export function serializeResumedSessionIds(
  sessionIds: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    schemaVersion: RESUMED_SESSIONS_SCHEMA_VERSION,
    sessionIds: [...sessionIds],
  };
}
