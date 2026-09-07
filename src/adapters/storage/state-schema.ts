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
import { EMPTY_DAEMON_HEALTH } from '../../core/daemon-health.js';

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
 *
 * `daemonHealth` is `.optional()` the same way (S4-T3b): a document written before this field
 * existed lacks the whole key, and the honest read is "no failure known" (`EMPTY_DAEMON_HEALTH`,
 * D-025), not a rejected file. No `schemaVersion` bump for this addition, same precedent
 * `captureAttemptsToday` already set — an additive, optional field doesn't need one.
 *
 * `lastLeadTimeWarningNoticeAt` is `.optional().nullable()` for the identical reason (S4-T7): a
 * real `estado.json` written before this field existed (the maintainer already has one running)
 * simply lacks the key, and "no lead-time warning notice recorded yet" is EXACTLY what that field's
 * own `null` already means (D-025's "ausência não vira afirmação", not "afirma que nunca vai
 * ocorrer" either — it's just the honest read of a fact this project never measured before). No
 * `schemaVersion` bump, no migration entry in `adapters/storage/schema-version.ts`: the same
 * additive-optional precedent `captureAttemptsToday`/`daemonHealth` already set two fields in a
 * row, decided the same way for the same reason.
 *
 * `firedLeadTimesEffectiveEndOfDay` is `.optional().nullable()` the same way (S4-T7 Part 3) — see
 * `core/types.ts#DayState.firedLeadTimesEffectiveEndOfDay` for why a MISSING key here is read as
 * "no evidence the deadline changed" rather than the reverse, and why that reading (not a
 * migration) is what protects a real, already-populated `estado.json` from a one-time spurious
 * re-fire the moment this code starts running.
 */
const daemonHealthDocumentSchema = z.object({
  lastCycleError: z.object({ message: z.string(), at: z.iso.datetime() }).nullable(),
  consecutiveCycleFailures: z.number().int().nonnegative(),
});

const stateDocumentSchema = z.object({
  day: z.string(),
  skipped: z.boolean(),
  snoozeMinutesTotal: z.number().int().nonnegative(),
  firedLeadTimesInMinutes: z.array(z.number()),
  firedLeadTimesEffectiveEndOfDay: z.iso.datetime().nullable().optional(),
  lastLeadTimeWarningNoticeAt: z.iso.datetime().nullable().optional(),
  endOfDayFired: z.boolean(),
  captureAttemptsToday: z.record(z.string(), z.number().int().nonnegative()).optional(),
  daemonHealth: daemonHealthDocumentSchema.optional(),
});

/** Shared by every S4-T7 `Date | null` field below: a missing key (older `estado.json`) and an
 * explicit `null` both read the same way — nothing recorded (D-025) — so both collapse to `null`
 * here instead of each caller repeating the `undefined || null` check (AGENTS.md § "Nada de
 * duplicação"). */
function parseOptionalNullableIsoDate(raw: string | null | undefined): Date | null {
  return raw === undefined || raw === null ? null : new Date(raw);
}

/** Parses `raw` (the document, already past `resolveSchemaVersion`) into `DayState`. */
export function parseStateDocument(raw: unknown): DayState {
  const result = stateDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`estado.json is malformed: ${z.prettifyError(result.error)}`);
  }
  const daemonHealth = result.data.daemonHealth;
  return {
    day: result.data.day,
    skipped: result.data.skipped,
    snoozeMinutesTotal: result.data.snoozeMinutesTotal,
    firedLeadTimesInMinutes: result.data.firedLeadTimesInMinutes,
    firedLeadTimesEffectiveEndOfDay: parseOptionalNullableIsoDate(
      result.data.firedLeadTimesEffectiveEndOfDay,
    ),
    lastLeadTimeWarningNoticeAt: parseOptionalNullableIsoDate(
      result.data.lastLeadTimeWarningNoticeAt,
    ),
    endOfDayFired: result.data.endOfDayFired,
    captureAttemptsToday: result.data.captureAttemptsToday ?? {},
    daemonHealth:
      daemonHealth === undefined
        ? EMPTY_DAEMON_HEALTH
        : {
            lastCycleError:
              daemonHealth.lastCycleError === null
                ? null
                : {
                    message: daemonHealth.lastCycleError.message,
                    at: new Date(daemonHealth.lastCycleError.at),
                  },
            consecutiveCycleFailures: daemonHealth.consecutiveCycleFailures,
          },
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
    firedLeadTimesEffectiveEndOfDay: state.firedLeadTimesEffectiveEndOfDay?.toISOString() ?? null,
    lastLeadTimeWarningNoticeAt: state.lastLeadTimeWarningNoticeAt?.toISOString() ?? null,
    endOfDayFired: state.endOfDayFired,
    captureAttemptsToday: state.captureAttemptsToday,
    daemonHealth: {
      lastCycleError:
        state.daemonHealth.lastCycleError === null
          ? null
          : {
              message: state.daemonHealth.lastCycleError.message,
              at: state.daemonHealth.lastCycleError.at.toISOString(),
            },
      consecutiveCycleFailures: state.daemonHealth.consecutiveCycleFailures,
    },
  };
}
