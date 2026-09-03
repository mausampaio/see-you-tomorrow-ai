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
import type { Handoff, HandoffFacts } from '../../core/types.js';
import type { SchemaMigration } from './schema-version.js';

/**
 * Current `schemaVersion` for a handoff document. Passed to `resolveSchemaVersion` by the adapter
 * (`index.ts`) before this module ever sees the document.
 *
 * **Bumped 1 → 2 by D-032 (S4-T0): `facts.git` moved from `GitFacts | null` to a list, one entry
 * per repository, plus two new counts.** `HANDOFF_SCHEMA_MIGRATIONS` below is what keeps a v1
 * handoff already on disk readable — the maintainer has real days captured before this change
 * (docs/PLANO-DE-ENTREGA.md S4-T0's own warning: subir a versão sem migração tornaria ilegível
 * todo handoff já gravado, e é exatamente isso que `seeya start-day` lê).
 */
export const HANDOFF_SCHEMA_VERSION = 2;

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

/** D-032: one entry of `facts.git[]` — `gitFactsSchema` plus the repository's own root. */
const repositoryGitFactsSchema = gitFactsSchema.extend({ root: z.string().min(1) });

const handoffFactsSchema = z.object({
  lastActivity: z.iso.datetime().nullable(),
  lastPrompts: z.array(z.string()),
  touchedFiles: z.array(z.string()),
  git: z.array(repositoryGitFactsSchema),
  /** `null` only for a handoff migrated up from schemaVersion 1 — see `HandoffFacts`'s own
   * docstring in `core/types.ts` for why that's never coerced to `0` (D-025). */
  filesOutsideRepository: z.number().int().nonnegative().nullable(),
  reposNotVisited: z.number().int().nonnegative().nullable(),
});

/**
 * D-032's mandatory migration: reshapes a schemaVersion-1 document's `facts.git` (`GitFacts |
 * null`) into schemaVersion 2's list, and adds the two new counts as `null` — a v1 record never
 * tracked either, so `0` would claim a measurement this project never took (D-025's "ausência não
 * vira afirmação", applied here to a migrated record instead of a freshly gathered one).
 *
 * Registered against `resolveSchemaVersion` (`schema-version.ts`) by `adapters/storage/index.ts`,
 * exactly the mechanism that module's own top comment already anticipated for "a future document"
 * — this is the first one to actually need it. Only reshapes `facts.git`/adds the two new keys;
 * anything else malformed in the rest of the document is left for `handoffDocumentSchema`'s own
 * validation to catch right after this returns — a migration's job is reshaping a value this build
 * already trusts is roughly the OLD version's shape, not re-validating the whole document.
 */
function migrateHandoffV1ToV2(document: Record<string, unknown>): Record<string, unknown> {
  const facts =
    typeof document.facts === 'object' && document.facts !== null
      ? (document.facts as Record<string, unknown>)
      : {};
  const oldGit = facts.git;
  const git = oldGit === null || oldGit === undefined ? [] : [oldGit];
  return {
    ...document,
    schemaVersion: 2,
    facts: { ...facts, git, filesOutsideRepository: null, reposNotVisited: null },
  };
}

/** Passed to `resolveSchemaVersion` for every handoff read (`adapters/storage/index.ts`) — the
 * production migrations table `schema-version.ts`'s own top comment says was empty "so far". */
export const HANDOFF_SCHEMA_MIGRATIONS: Readonly<Record<number, SchemaMigration>> = {
  1: migrateHandoffV1ToV2,
};

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
  return {
    lastActivity: raw.lastActivity === null ? null : new Date(raw.lastActivity),
    lastPrompts: raw.lastPrompts,
    assistantMessages: [],
    touchedFiles: raw.touchedFiles,
    git: raw.git,
    filesOutsideRepository: raw.filesOutsideRepository,
    reposNotVisited: raw.reposNotVisited,
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
      filesOutsideRepository: handoff.facts.filesOutsideRepository,
      reposNotVisited: handoff.facts.reposNotVisited,
    },
    understanding: handoff.understanding,
    pendingItems: handoff.pendingItems,
    tomorrowPlan: handoff.tomorrowPlan,
    generationError: handoff.generationError,
  };
}
