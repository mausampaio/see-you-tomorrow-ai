/**
 * `~/.seeya/early-warnings.json`'s shape and its resolution into `EarlyWarningState`
 * (`core/types.ts`). A new document with a new disk identifier: it isn't yet in AGENTS.md's
 * "Identificadores que vão para disco" table (S1-T0g fixed that table before this task existed).
 * Named and shaped here with the reasoning written down, and flagged in docs/QUESTOES.md for the
 * PO to fix in the glossary — the same non-blocking pattern Q-005/Q-013 already used for
 * `deepCapture`/`forkCleanupDays`, which is exactly this situation: a name invented under a
 * documented reason, not guessed.
 *
 * Same corruption policy as `config-schema.ts`: a missing file means "nothing warned about yet"
 * (D-025); a present-but-malformed file is a visible error, never silently read as empty.
 *
 * **Not validated item-by-item (D-022).** D-022's per-item rule is for tolerating an external,
 * unfamiliar reality (Claude Code's own records, transcript, `claude -p` output) where one bad
 * entry shouldn't cost the whole batch. This document has no such source: every entry in it was
 * written by `StorageAdapter#saveEarlyWarningState` itself (`index.ts`), so a malformed entry
 * means the file was corrupted or hand-edited, not that an unfamiliar format arrived from outside
 * — the same reasoning `config-schema.ts` already applies to whole-document fields like
 * `leadTimesInMinutes`.
 */
import { z } from 'zod';
import type { EarlyWarningState } from '../../core/types.js';

/** Current `schemaVersion` for `early-warnings.json`. Passed to `resolveSchemaVersion` by the
 * adapter (`index.ts`) before this module ever sees the document. */
export const EARLY_WARNING_SCHEMA_VERSION = 1;

/**
 * Validates everything BUT `schemaVersion` — by the time this runs, `resolveSchemaVersion` has
 * already confirmed the document is at `EARLY_WARNING_SCHEMA_VERSION`. No `.strict()`: an
 * unrecognized top-level key is ignored rather than failing the whole file, same tolerance every
 * other schema in this project gives to a future field (D-021's spirit).
 */
const earlyWarningDocumentSchema = z.object({
  notifiedMissingTranscriptSessionIds: z.array(z.string()).optional(),
  notifiedUninspectableSessionKeys: z.array(z.string()).optional(),
});

/**
 * Parses `raw` (the document, already past `resolveSchemaVersion`) into `EarlyWarningState`. A
 * field the document doesn't mention resolves to an empty set — the file existing at all with the
 * other field present is normal (only one trigger may have fired so far), not corruption.
 */
export function parseEarlyWarningDocument(raw: unknown): EarlyWarningState {
  const result = earlyWarningDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`early-warnings.json is malformed: ${z.prettifyError(result.error)}`);
  }
  return {
    notifiedMissingTranscriptSessionIds: new Set(
      result.data.notifiedMissingTranscriptSessionIds ?? [],
    ),
    notifiedUninspectableSessionKeys: new Set(result.data.notifiedUninspectableSessionKeys ?? []),
  };
}

/**
 * The inverse of `parseEarlyWarningDocument` — what `StorageAdapter#saveEarlyWarningState` writes.
 * A `Set` has no stable JSON form of its own, so this is the one place that picks the array order
 * (insertion order, `Set`'s own iteration order) — irrelevant to `detectEarlyWarnings`, which only
 * ever calls `.has()` on the set built back from it.
 */
export function serializeEarlyWarningState(state: EarlyWarningState): Record<string, unknown> {
  return {
    schemaVersion: EARLY_WARNING_SCHEMA_VERSION,
    notifiedMissingTranscriptSessionIds: [...state.notifiedMissingTranscriptSessionIds],
    notifiedUninspectableSessionKeys: [...state.notifiedUninspectableSessionKeys],
  };
}
