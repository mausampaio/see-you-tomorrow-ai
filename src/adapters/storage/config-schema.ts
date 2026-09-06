/**
 * `~/.seeya/config.json`'s shape (docs/ARQUITETURA.md § "Config") and its resolution into the
 * domain `Config` type (`core/types.ts`). Every key here is the exact identifier fixed by
 * AGENTS.md § "Idioma" ("Identificadores que vão para disco") — this file does not invent a name
 * that table doesn't already have.
 *
 * Every field but `schemaVersion` (handled separately, before this schema ever runs — see
 * `schema-version.ts`) is optional and defaulted: a config file that's missing some keys still
 * resolves to a complete, usable `Config` for the keys it doesn't mention (D-025, the same spirit
 * as a config file that doesn't exist at all). A field that IS present but the wrong shape (a
 * string where a number is expected, an out-of-range time, etc.) fails validation for the whole
 * file — that's corruption, not absence, and D-025's "use the defaults" only covers absence
 * (docs/PLANO-DE-ENTREGA.md S1-T5's acceptance: corrupted config is a visible error, never a
 * silent default).
 */
import { z } from 'zod';
import type { Config, ProjectPolicy } from '../../core/types.js';

/** Current `schemaVersion` for `config.json`. Passed to `resolveSchemaVersion` by the adapter
 * (`index.ts`) before this module ever sees the document. */
export const CONFIG_SCHEMA_VERSION = 1;

const projectPolicySchema = z.object({
  canTerminate: z.boolean().optional(),
  deepCapture: z.boolean().optional(),
});

/**
 * Validates everything BUT `schemaVersion` — by the time this runs, `resolveSchemaVersion` has
 * already confirmed the document is at `CONFIG_SCHEMA_VERSION` and stripped that concern out.
 * No `.strict()`: an unrecognized top-level key (a future field, a typo) is ignored rather than
 * failing the whole file, matching this project's general tolerance for the unfamiliar in
 * external data (D-021's spirit) rather than only the Claude Code schemas it was written for.
 */
const configFileSchema = z.object({
  endOfDayTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected 24h local time "HH:MM"')
    .nullable()
    .optional(),
  leadTimesInMinutes: z.array(z.number().int().nonnegative()).optional(),
  relevanceHours: z.number().positive().optional(),
  idleMinutes: z.number().nonnegative().optional(),
  captureModel: z.string().min(1).optional(),
  budgetPerSessionUsd: z.number().nonnegative().optional(),
  // >=1: a concurrency of 0 would mean no capture could ever run, a config value that can only
  // ever be a mistake, never an intentional "disable AI capture" (that's budgetPerSessionUsd: 0,
  // read by the generation adapter in S2-T2 — out of this task's scope to enforce here).
  captureConcurrency: z.number().int().positive().optional(),
  ignore: z.array(z.string()).optional(),
  projectPolicy: z.record(z.string(), projectPolicySchema).optional(),
  // >0: D-012 always deletes eventually; 0 or negative would mean "delete on sight", which is
  // not what "days to keep" can mean, and isn't a value forkCleanupDays's own definition allows.
  forkCleanupDays: z.number().int().positive().optional(),
  // D-035's four numbers, moved here from hardcoded constants with the constant's own value as
  // default (see CONFIG_DEFAULTS below) — "com o valor atual como default, então nada muda de
  // comportamento". Each keeps the >=1 constraint its origin already enforced implicitly (a
  // ceiling/budget of 0 could only ever be a mistake, same reasoning as captureConcurrency above),
  // except maxBriefingScanDays, whose own docstring already treats 0 ("only look at today") as
  // meaningful, not a mistake.
  maxGitRootsToVisit: z.number().int().positive().optional(),
  maxCaptureAttemptsPerSessionPerDay: z.number().int().positive().optional(),
  maxBriefingScanDays: z.number().int().nonnegative().optional(),
  // D-036: this now governs ACTION (skip termination), not just notice wording — still a duration
  // in minutes like idleMinutes above, so it keeps that field's shape (nonnegative, fractional
  // allowed) rather than forcing an integer nobody asked for.
  overdueFireThresholdMinutes: z.number().nonnegative().optional(),
});

/**
 * Defaults for every field a `config.json` doesn't mention (or the file doesn't exist at all).
 *
 * **Not sourced from an explicit "these are the defaults" table.** docs/ARQUITETURA.md § "Config"
 * only shows an illustrative example file (its own `ignore` and `projectPolicy` entries are
 * clearly sample data, not defaults), and only `relevanceHours` (12h) has its default spelled out
 * in prose (docs/ESPECIFICACAO.md § "Elegibilidade"). The rest of the numeric/structural defaults
 * below match that example's values, the most concrete authority available. `endOfDayTime`
 * deliberately does NOT follow the example's `"19:30"` — see docs/QUESTOES.md Q-013 for why
 * `null` (manual-only) is the safer default until `seeya init` (S5-T2) lets someone actually
 * choose a time, and why this is flagged instead of assumed silently.
 *
 * `forkCleanupDays` defaults to 7 — not taken from `docs/ARQUITETURA.md`'s example (which doesn't
 * list the key at all, Q-013), but straight from D-012's own text: "Forks com mais de
 * `forkCleanupDays` (default 7) são apagados." Unlike `endOfDayTime`, this default carries no
 * opt-in risk to soften: D-012's exception is scoped to `seeya`'s own forks (D-020, only ones the
 * app itself created and registered), never something a fresh install could accidentally point at
 * a file the user cares about.
 */
const CONFIG_DEFAULTS: Config = {
  endOfDayTime: null,
  leadTimesInMinutes: [30, 15],
  relevanceHours: 12,
  idleMinutes: 45,
  captureModel: 'sonnet',
  budgetPerSessionUsd: 0.25,
  captureConcurrency: 3,
  ignore: [],
  projectPolicy: {},
  forkCleanupDays: 7,
  // D-035's four numbers, each the exact value its prior hardcoded constant already used
  // (`adapters/git/git-adapter.ts#MAX_GIT_ROOTS_TO_VISIT`,
  // `core/capture-retry.ts#MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY`,
  // `application/find-pending-briefing.ts#MAX_BRIEFING_SCAN_DAYS`, and the 5 minutes
  // `scheduler/notices.ts` used to hardcode as `DELAY_WARNING_THRESHOLD_MS`) — kept as separate
  // literals here rather than imported, the same "each layer re-pins the same documented number"
  // convention `scheduler/`'s own `POLL_INTERVAL_MS` already uses, since `core/` (where
  // `capture-retry.ts` lives) cannot import this `adapters/` module (docs/ARQUITETURA.md's layer
  // matrix) to share a single source of truth.
  maxGitRootsToVisit: 8,
  maxCaptureAttemptsPerSessionPerDay: 3,
  maxBriefingScanDays: 30,
  overdueFireThresholdMinutes: 5,
};

/** `parseConfigDocument({})` — every field at its default. Exported so callers (the adapter, on a
 * missing file; tests) don't need to reconstruct this by calling the parser on an empty object. */
export const DEFAULT_CONFIG: Config = CONFIG_DEFAULTS;

type RawProjectPolicy = Record<
  string,
  { canTerminate?: boolean | undefined; deepCapture?: boolean | undefined }
>;

/** Fills each project's own `canTerminate`/`deepCapture` default independently — a project
 * mentioned with only one of the two flags gets the other at its safe (opt-in) default, not
 * `undefined` (D-002, D-011: both flags are opt-in, silence about one means "not opted in"). */
function resolveProjectPolicy(
  raw: RawProjectPolicy | undefined,
): Readonly<Record<string, ProjectPolicy>> {
  if (raw === undefined) {
    return CONFIG_DEFAULTS.projectPolicy;
  }
  const resolved: Record<string, ProjectPolicy> = {};
  for (const [cwd, policy] of Object.entries(raw)) {
    resolved[cwd] = {
      canTerminate: policy.canTerminate ?? false,
      deepCapture: policy.deepCapture ?? false,
    };
  }
  return resolved;
}

/**
 * Parses `raw` (the config document, already past `resolveSchemaVersion`) against
 * `configFileSchema` and fills in `CONFIG_DEFAULTS` for every field it doesn't mention. Throws a
 * plain `Error` on a present-but-malformed field (AGENTS.md § "Mensagens de erro": the message
 * already carries the offending value and the expected shape via `z.prettifyError`) — that's the
 * "corrupted, not absent" branch the caller (`index.ts`) surfaces as a visible failure.
 */
/**
 * Every `Config` field `seeya config set`/`get` (S4-T4) can address directly by name —
 * everything except `projectPolicy`, which is keyed by `cwd` rather than a flat scalar and gets
 * its own sub-action (`seeya config policy <cwd>`) instead of a `key=value` pair. Order matches
 * `Config`'s own field order (`core/types.ts`), so `formatWholeConfig` below and this list read
 * the same way top to bottom.
 *
 * **D-027: this list, not a generic "any key in the JSON" acceptance, is what makes an unknown
 * key a refused write instead of a silently-created new document field** — `parseConfigFieldUpdate`
 * checks against this before ever touching `configFileSchema`.
 */
export const EDITABLE_CONFIG_KEYS = [
  'endOfDayTime',
  'leadTimesInMinutes',
  'relevanceHours',
  'idleMinutes',
  'captureModel',
  'budgetPerSessionUsd',
  'captureConcurrency',
  'ignore',
  'forkCleanupDays',
  'maxGitRootsToVisit',
  'maxCaptureAttemptsPerSessionPerDay',
  'maxBriefingScanDays',
  'overdueFireThresholdMinutes',
] as const;

export type EditableConfigKey = (typeof EDITABLE_CONFIG_KEYS)[number];

/** Exported so `cli/config-command.ts#runConfigGetCommand` can narrow a raw CLI string the same
 * way `parseConfigFieldUpdate` does below, instead of re-deriving the same `includes` check with
 * its own cast (AGENTS.md § "Nada de duplicação" and § "Tipos": one real type guard, not two
 * differently-typed checks of the same list). */
export function isEditableConfigKey(key: string): key is EditableConfigKey {
  return (EDITABLE_CONFIG_KEYS as readonly string[]).includes(key);
}

/** AGENTS.md § "Mensagens de erro": names the received key AND the expected set, every time this
 * fires — `cli/config-command.ts` reuses this exact text for both `get <key>` and `set <key> ...`
 * instead of writing the message twice. */
export function unknownConfigKeyMessage(key: string): string {
  return (
    `unknown config key "${key}". Expected one of: ${EDITABLE_CONFIG_KEYS.join(', ')} ` +
    '(for "projectPolicy", use "seeya config policy <cwd>" instead).'
  );
}

/**
 * Splits a comma-separated CLI argument into trimmed, non-empty parts — shared by every
 * list-shaped field (`leadTimesInMinutes`, `ignore`). An empty/whitespace-only `raw` (e.g. `""`)
 * resolves to `[]`, which is how a person clears a list back to empty, not a parse error.
 */
function splitCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Turns the CLI's raw string argument into the shape `configFileSchema`'s per-field validator
 * expects — coercion only, no validation of its own (an out-of-range or non-numeric value is
 * still let through here and caught by the zod schema right after, so there is exactly one place
 * that decides "valid or not"). `endOfDayTime`'s literal `"null"` (case-insensitive) is the one
 * way to type "disable the scheduled trigger" from a CLI that otherwise only ever hands this
 * function non-empty strings — `configFileSchema.endOfDayTime` already accepts a real `null`,
 * this just gives a person a way to type it.
 */
function coerceRawConfigValue(key: EditableConfigKey, raw: string): unknown {
  switch (key) {
    case 'endOfDayTime':
      return raw.trim().toLowerCase() === 'null' ? null : raw;
    case 'leadTimesInMinutes':
      return splitCommaList(raw).map(Number);
    case 'ignore':
      return splitCommaList(raw);
    case 'captureModel':
      return raw;
    // Every remaining editable key is a bare number (int or float, `configFileSchema`'s own
    // per-field constraint decides which) — relevanceHours, idleMinutes, budgetPerSessionUsd,
    // captureConcurrency, forkCleanupDays, and D-035's four (maxGitRootsToVisit,
    // maxCaptureAttemptsPerSessionPerDay, maxBriefingScanDays, overdueFireThresholdMinutes).
    default:
      return Number(raw);
  }
}

/**
 * Validates `rawValue` for `key` against `configFileSchema`'s OWN per-field constraint —
 * `configFileSchema.shape[key]` reused directly rather than re-declared here, so a range/regex
 * change to that schema (e.g. `endOfDayTime`'s `"HH:MM"` regex) never drifts out of sync with what
 * `seeya config set` accepts (AGENTS.md § "Nada de duplicação"). Returns the key back narrowed to
 * `EditableConfigKey` on success so `cli/config-command.ts` never has to re-check
 * `isEditableConfigKey` itself before calling `applyConfigFieldUpdate`.
 */
export function parseConfigFieldUpdate(
  key: string,
  rawValue: string,
):
  | { readonly ok: true; readonly key: EditableConfigKey; readonly value: unknown }
  | { readonly ok: false; readonly error: string } {
  if (!isEditableConfigKey(key)) {
    return { ok: false, error: unknownConfigKeyMessage(key) };
  }
  const coerced = coerceRawConfigValue(key, rawValue);
  const fieldSchema = configFileSchema.shape[key];
  const result = fieldSchema.safeParse(coerced);
  if (!result.success) {
    return {
      ok: false,
      error: `invalid value "${rawValue}" for "${key}": ${z.prettifyError(result.error)}`,
    };
  }
  return { ok: true, key, value: result.data };
}

/**
 * Applies one already-validated field update onto `current`, producing the next `Config` to
 * persist. `value: unknown` plus a per-case cast (not one blanket cast at the end) is deliberate:
 * each branch's cast is only ever reached with the value `parseConfigFieldUpdate` just validated
 * against THAT SAME key's schema, one line up — the cast documents "this was proven safe by the
 * zod parse right before this call", not "trust me" (AGENTS.md § "Tipos": `as` in production is a
 * last resort, and this is the narrowest form it can take for a CLI's inherently dynamic key).
 */
export function applyConfigFieldUpdate(
  current: Config,
  key: EditableConfigKey,
  value: unknown,
): Config {
  switch (key) {
    case 'endOfDayTime':
      return { ...current, endOfDayTime: value as string | null };
    case 'leadTimesInMinutes':
      return { ...current, leadTimesInMinutes: value as readonly number[] };
    case 'relevanceHours':
      return { ...current, relevanceHours: value as number };
    case 'idleMinutes':
      return { ...current, idleMinutes: value as number };
    case 'captureModel':
      return { ...current, captureModel: value as string };
    case 'budgetPerSessionUsd':
      return { ...current, budgetPerSessionUsd: value as number };
    case 'captureConcurrency':
      return { ...current, captureConcurrency: value as number };
    case 'ignore':
      return { ...current, ignore: value as readonly string[] };
    case 'forkCleanupDays':
      return { ...current, forkCleanupDays: value as number };
    case 'maxGitRootsToVisit':
      return { ...current, maxGitRootsToVisit: value as number };
    case 'maxCaptureAttemptsPerSessionPerDay':
      return { ...current, maxCaptureAttemptsPerSessionPerDay: value as number };
    case 'maxBriefingScanDays':
      return { ...current, maxBriefingScanDays: value as number };
    case 'overdueFireThresholdMinutes':
      return { ...current, overdueFireThresholdMinutes: value as number };
  }
}

/**
 * `seeya config policy <cwd>` (D-002, D-011): sets `canTerminate`/`deepCapture` independently for
 * one `cwd`, defaulting whichever flag WASN'T passed to its previous value — or to the safe opt-in
 * default (`false`) when `cwd` has no entry yet at all — never to `undefined`. Same
 * per-field-independent defaulting `resolveProjectPolicy` above already applies on READ; this is
 * the WRITE side of the identical rule.
 *
 * Returns the resolved `policy` alongside the updated `Config` — not just the `Config` — so a
 * caller (`cli/config-command.ts`) can report exactly what was written without reading it back out
 * of `updated.projectPolicy[cwd]` with a non-null assertion (AGENTS.md § "Tipos": `!` is a sign the
 * type is wrong, not that the reader knows better; here the type system genuinely can't know a
 * `Record<string, ProjectPolicy>` has `cwd` as a key without this function saying so directly).
 */
export function applyProjectPolicyUpdate(
  current: Config,
  cwd: string,
  updates: { readonly canTerminate?: boolean; readonly deepCapture?: boolean },
): { readonly config: Config; readonly policy: ProjectPolicy } {
  const existing = current.projectPolicy[cwd] ?? { canTerminate: false, deepCapture: false };
  const policy: ProjectPolicy = {
    canTerminate: updates.canTerminate ?? existing.canTerminate,
    deepCapture: updates.deepCapture ?? existing.deepCapture,
  };
  const config: Config = { ...current, projectPolicy: { ...current.projectPolicy, [cwd]: policy } };
  return { config, policy };
}

/** Plain-text rendering of one config value (AGENTS.md § "Registro e saída": user-facing output
 * is plain text, never raw JSON) — shared by `seeya config get`'s whole-config and single-key
 * forms so the two never format the same value two different ways. */
export function formatConfigValue(
  value: string | number | boolean | null | readonly string[] | readonly number[],
): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '(empty)' : value.join(', ');
  }
  return String(value);
}

/** The inverse of `parseConfigDocument` — what `StorageAdapter#saveConfig` writes. Always writes
 * every field (never a partial patch, same "whole document" contract `serializeState` already
 * has for `estado.json`), including `projectPolicy` untouched when this particular write didn't
 * target it. */
export function serializeConfigDocument(config: Config): Record<string, unknown> {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    endOfDayTime: config.endOfDayTime,
    leadTimesInMinutes: config.leadTimesInMinutes,
    relevanceHours: config.relevanceHours,
    idleMinutes: config.idleMinutes,
    captureModel: config.captureModel,
    budgetPerSessionUsd: config.budgetPerSessionUsd,
    captureConcurrency: config.captureConcurrency,
    ignore: config.ignore,
    projectPolicy: config.projectPolicy,
    forkCleanupDays: config.forkCleanupDays,
    maxGitRootsToVisit: config.maxGitRootsToVisit,
    maxCaptureAttemptsPerSessionPerDay: config.maxCaptureAttemptsPerSessionPerDay,
    maxBriefingScanDays: config.maxBriefingScanDays,
    overdueFireThresholdMinutes: config.overdueFireThresholdMinutes,
  };
}

export function parseConfigDocument(raw: unknown): Config {
  const result = configFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`config.json is malformed: ${z.prettifyError(result.error)}`);
  }
  const fields = result.data;
  return {
    endOfDayTime: fields.endOfDayTime ?? CONFIG_DEFAULTS.endOfDayTime,
    leadTimesInMinutes: fields.leadTimesInMinutes ?? CONFIG_DEFAULTS.leadTimesInMinutes,
    relevanceHours: fields.relevanceHours ?? CONFIG_DEFAULTS.relevanceHours,
    idleMinutes: fields.idleMinutes ?? CONFIG_DEFAULTS.idleMinutes,
    captureModel: fields.captureModel ?? CONFIG_DEFAULTS.captureModel,
    budgetPerSessionUsd: fields.budgetPerSessionUsd ?? CONFIG_DEFAULTS.budgetPerSessionUsd,
    captureConcurrency: fields.captureConcurrency ?? CONFIG_DEFAULTS.captureConcurrency,
    ignore: fields.ignore ?? CONFIG_DEFAULTS.ignore,
    projectPolicy: resolveProjectPolicy(fields.projectPolicy),
    forkCleanupDays: fields.forkCleanupDays ?? CONFIG_DEFAULTS.forkCleanupDays,
    maxGitRootsToVisit: fields.maxGitRootsToVisit ?? CONFIG_DEFAULTS.maxGitRootsToVisit,
    maxCaptureAttemptsPerSessionPerDay:
      fields.maxCaptureAttemptsPerSessionPerDay ??
      CONFIG_DEFAULTS.maxCaptureAttemptsPerSessionPerDay,
    maxBriefingScanDays: fields.maxBriefingScanDays ?? CONFIG_DEFAULTS.maxBriefingScanDays,
    overdueFireThresholdMinutes:
      fields.overdueFireThresholdMinutes ?? CONFIG_DEFAULTS.overdueFireThresholdMinutes,
  };
}
