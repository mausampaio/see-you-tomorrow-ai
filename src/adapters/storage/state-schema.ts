/**
 * `~/.seeya/estado.json`'s shape and its resolution into `DayState` (`core/types.ts`, D-006's own
 * text names this exact file; AGENTS.md § "Idioma" reserves it and `Storage.saveState`). S4-T3.
 *
 * Same corruption policy as `config-schema.ts`/`early-warning-schema.ts`: a missing file means "no
 * daemon poll or `seeya snooze`/`skip-today` has ever run on this machine" (D-025), never an error;
 * a present-but-malformed file rejects loudly instead of silently reading back as a fresh day.
 *
 * **Not validated item-by-item (D-022).** Same reasoning `early-warning-schema.ts`/
 * `resumed-sessions-schema.ts` already give: every field here was written by
 * `StorageAdapter#saveState` itself, never an external, unfamiliar source (unlike the Claude Code
 * registry/transcript this project also reads) — a malformed value means the file was corrupted or
 * hand-edited, not that an unfamiliar format arrived from outside.
 */
import { z } from 'zod';
import type { DayState } from '../../core/types.js';

/** Current `schemaVersion` for `estado.json`. Passed to `resolveSchemaVersion` by the adapter
 * (`index.ts`) before this module ever sees the document. */
export const STATE_SCHEMA_VERSION = 1;

/**
 * Validates everything BUT `schemaVersion` — by the time this runs, `resolveSchemaVersion` has
 * already confirmed the document is at `STATE_SCHEMA_VERSION`. No `.strict()`: an unrecognized
 * top-level key is ignored rather than failing the whole file, same tolerance every other schema in
 * this project gives to a future field (D-021's spirit).
 *
 * `captureAttemptsToday` is `.optional()`, defaulting to `{}` on read (`parseStateDocument` below)
 * — a document written before S4-T3 added this field (there is no such document yet, since this is
 * this field's very first version, but the same tolerance every other optional field here already
 * gets) or one a person hand-edited without it should still read as "nothing attempted yet", not
 * fail the whole file.
 */
const stateDocumentSchema = z.object({
  day: z.string(),
  skipped: z.boolean(),
  snoozeMinutesTotal: z.number().int().nonnegative(),
  firedLeadTimesInMinutes: z.array(z.number()),
  endOfDayFired: z.boolean(),
  captureAttemptsToday: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

/** Parses `raw` (the document, already past `resolveSchemaVersion`) into `DayState`. */
export function parseStateDocument(raw: unknown): DayState {
  const result = stateDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`estado.json is malformed: ${z.prettifyError(result.error)}`);
  }
  return {
    day: result.data.day,
    skipped: result.data.skipped,
    snoozeMinutesTotal: result.data.snoozeMinutesTotal,
    firedLeadTimesInMinutes: result.data.firedLeadTimesInMinutes,
    endOfDayFired: result.data.endOfDayFired,
    captureAttemptsToday: result.data.captureAttemptsToday ?? {},
  };
}

/** The inverse of `parseStateDocument` — what `StorageAdapter#saveState` writes. */
export function serializeState(state: DayState): Record<string, unknown> {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    day: state.day,
    skipped: state.skipped,
    snoozeMinutesTotal: state.snoozeMinutesTotal,
    firedLeadTimesInMinutes: state.firedLeadTimesInMinutes,
    endOfDayFired: state.endOfDayFired,
    captureAttemptsToday: state.captureAttemptsToday,
  };
}
