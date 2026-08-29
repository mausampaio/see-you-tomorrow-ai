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
  };
}
