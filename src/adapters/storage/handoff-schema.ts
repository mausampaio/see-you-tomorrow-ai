/**
 * `~/.seeya/days/<day>/sessions/<sessionId>.json`'s shape (docs/ESPECIFICACAO.md § "Formato do
 * handoff") and its resolution into `Handoff` (`core/types.ts`). Every key matches AGENTS.md §
 * "Idioma"'s "Identificadores que vão para disco" table exactly.
 *
 * **Not validated item-by-item (D-022).** Same reasoning as `early-warning-schema.ts`: every
 * handoff on disk was written by `StorageAdapter#saveHandoff` itself (`application/endDay`,
 * S2-T3), never by an external, unfamiliar source — a malformed file here means corruption or a
 * hand-edit, not a format this project doesn't control yet.
 */
import { z } from 'zod';
import type { GitFacts, Handoff, HandoffFacts } from '../../core/types.js';

/** Current `schemaVersion` for a handoff document. Passed to `resolveSchemaVersion` by the adapter
 * (`index.ts`) before this module ever sees the document. */
export const HANDOFF_SCHEMA_VERSION = 1;

const gitCommitSchema = z.object({ sha: z.string(), title: z.string() });

const worktreeFactsSchema = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  dirty: z.boolean(),
  commitsTodayCount: z.number().int().nonnegative(),
});

const gitFactsSchema = z.object({
  branch: z.string().nullable(),
  dirty: z.boolean(),
  modifiedFiles: z.array(z.string()),
  commitsToday: z.array(gitCommitSchema),
  worktrees: z.array(worktreeFactsSchema),
});

const handoffFactsSchema = z.object({
  lastActivity: z.iso.datetime().nullable(),
  lastPrompts: z.array(z.string()),
  touchedFiles: z.array(z.string()),
  git: gitFactsSchema.nullable(),
});

/**
 * Validates everything BUT `schemaVersion` — by the time this runs, `resolveSchemaVersion` has
 * already confirmed the document is at `HANDOFF_SCHEMA_VERSION`. No `.strict()`: an unrecognized
 * top-level key is ignored rather than failing the whole file, same tolerance every other schema
 * in this project gives a future field (D-021's spirit).
 */
const handoffDocumentSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  name: z.string().min(1),
  capturedAt: z.iso.datetime(),
  sessionState: z.enum(['alive', 'idle', 'ended', 'unknown']),
  capturedDuringActiveTurn: z.boolean(),
  source: z.enum(['model', 'deterministic', 'noTranscript']),
  captureMode: z.enum(['lean', 'deep']),
  sources: z.array(z.enum(['git', 'transcript', 'registry'])),
  facts: handoffFactsSchema,
  understanding: z.string(),
  pendingItems: z.array(z.string()),
  tomorrowPlan: z.array(z.string()),
  generationError: z.string().nullable(),
});

/**
 * `assistantMessages` (S4-T00c, `core/types.ts#SessionFacts`) is deliberately absent from
 * `handoffFactsSchema` above and from `serializeHandoff` below — see that field's own docstring
 * and docs/QUESTOES.md Q-036: it feeds the lean prompt, it is not a persisted key. Reading it back
 * from disk therefore always answers `[]`, the same "not found" D-025 already gives any other
 * field this document never wrote — never an invented reconstruction of what the assistant said.
 */
function parseHandoffFacts(raw: z.infer<typeof handoffFactsSchema>): HandoffFacts {
  const git: GitFacts | null = raw.git;
  return {
    lastActivity: raw.lastActivity === null ? null : new Date(raw.lastActivity),
    lastPrompts: raw.lastPrompts,
    assistantMessages: [],
    touchedFiles: raw.touchedFiles,
    git,
  };
}

/**
 * Parses `raw` (the document, already past `resolveSchemaVersion`) into `Handoff`. Throws a plain
 * `Error` on a malformed field (AGENTS.md § "Mensagens de erro": `z.prettifyError` already carries
 * the offending value and the expected shape) — the "corrupted, not absent" branch `index.ts`
 * surfaces as a visible failure, same as `parseConfigDocument`/`parseEarlyWarningDocument`.
 */
export function parseHandoffDocument(raw: unknown): Handoff {
  const result = handoffDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`handoff is malformed: ${z.prettifyError(result.error)}`);
  }
  const data = result.data;
  return {
    sessionId: data.sessionId,
    cwd: data.cwd,
    name: data.name,
    capturedAt: new Date(data.capturedAt),
    sessionState: data.sessionState,
    capturedDuringActiveTurn: data.capturedDuringActiveTurn,
    source: data.source,
    captureMode: data.captureMode,
    sources: data.sources,
    facts: parseHandoffFacts(data.facts),
    understanding: data.understanding,
    pendingItems: data.pendingItems,
    tomorrowPlan: data.tomorrowPlan,
    generationError: data.generationError,
  };
}

/**
 * The inverse of `parseHandoffDocument` — what `StorageAdapter#saveHandoff` writes. Plain
 * `Record<string, unknown>` (not `Handoff`) because the on-disk shape encodes `Date` fields as ISO
 * strings, a different shape than the domain type's own `Date` fields.
 */
export function serializeHandoff(handoff: Handoff): Record<string, unknown> {
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    sessionId: handoff.sessionId,
    cwd: handoff.cwd,
    name: handoff.name,
    capturedAt: handoff.capturedAt.toISOString(),
    sessionState: handoff.sessionState,
    capturedDuringActiveTurn: handoff.capturedDuringActiveTurn,
    source: handoff.source,
    captureMode: handoff.captureMode,
    sources: handoff.sources,
    facts: {
      lastActivity:
        handoff.facts.lastActivity === null ? null : handoff.facts.lastActivity.toISOString(),
      lastPrompts: handoff.facts.lastPrompts,
      // handoff.facts.assistantMessages is deliberately NOT written here — see
      // parseHandoffFacts's docstring above and docs/QUESTOES.md Q-036.
      touchedFiles: handoff.facts.touchedFiles,
      git: handoff.facts.git,
    },
    understanding: handoff.understanding,
    pendingItems: handoff.pendingItems,
    tomorrowPlan: handoff.tomorrowPlan,
    generationError: handoff.generationError,
  };
}
