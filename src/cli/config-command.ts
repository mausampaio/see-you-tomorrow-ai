/**
 * `seeya config` (docs/ESPECIFICACAO.md § "seeya config", D-027, D-035). Three sub-actions:
 *
 * - `get [key]` — prints the whole config, or one key.
 * - `set <key> <value>` — validates before writing (D-027: "nome de chave é formato"). An unknown
 *   key or a value the schema would reject is refused, never silently coerced or half-written.
 * - `policy <cwd> [--can-terminate <bool>] [--deep-capture <bool>]` — the one category
 *   (`projectPolicy`, D-002/D-011) that isn't a flat scalar `Config` field, so it gets its own
 *   sub-action instead of a `key=value` pair `set` could express.
 *
 * These three cover every category docs/ESPECIFICACAO.md names ("horário, antecedências de
 * notificação, política por `cwd`, modelo usado na captura, e limites"): every one of those is a
 * scalar `Config` field reachable through `get`/`set` except project policy, which `policy`
 * covers. The spec names categories, not literal subcommand verbs — this file's own shape is a
 * design choice, registered in docs/QUESTOES.md Q-056, not a literal requirement.
 *
 * Reads and writes go through `Storage.readConfig`/`saveConfig` only, every single call — no
 * config held in memory across the two subcommands of one invocation, let alone across
 * invocations. That is what makes this command's write visible to a concurrently-running daemon
 * on its very next poll (`scheduler/poll.ts` re-reads `config.json` at the top of every cycle),
 * the same "persisted, not remembered" discipline `estado.json`/`seeya snooze` already has (D-006).
 */
import {
  applyConfigFieldUpdate,
  applyProjectPolicyUpdate,
  CONFIG_SCHEMA_VERSION,
  EDITABLE_CONFIG_KEYS,
  formatConfigValue,
  isEditableConfigKey,
  parseConfigFieldUpdate,
  schemaVersionNotEditableMessage,
  unknownConfigKeyMessage,
} from '../adapters/storage/config-schema.js';
import type { Storage } from '../core/ports.js';
import type { Config, ProjectPolicy } from '../core/types.js';

export interface ConfigCommandContext {
  readonly storage: Storage;
}

function renderProjectPolicyLine(cwd: string, policy: ProjectPolicy): string {
  return `${cwd}: canTerminate=${policy.canTerminate}, deepCapture=${policy.deepCapture}`;
}

function renderProjectPolicySection(config: Config): string {
  const entries = Object.entries(config.projectPolicy);
  if (entries.length === 0) {
    return 'projectPolicy: (none)';
  }
  return [
    'projectPolicy:',
    ...entries.map(([cwd, policy]) => `  ${renderProjectPolicyLine(cwd, policy)}`),
  ].join('\n');
}

function renderWholeConfig(config: Config): string {
  const scalarLines = EDITABLE_CONFIG_KEYS.map(
    (key) => `${key}: ${formatConfigValue(config[key])}`,
  );
  return [...scalarLines, renderProjectPolicySection(config)].join('\n');
}

export async function runConfigGetCommand(
  context: ConfigCommandContext,
  key: string | undefined,
): Promise<string> {
  const config = await context.storage.readConfig();
  if (key === undefined) {
    return renderWholeConfig(config);
  }
  if (key === 'projectPolicy') {
    return renderProjectPolicySection(config);
  }
  // S4-T6: `schemaVersion` is real and required (checked on every config/handoff read) — it's
  // just not part of `Config` itself (`resolveSchemaVersion` strips it out before
  // `configFileSchema` ever runs, `adapters/storage/config-schema.ts`'s own top comment), so there
  // is no `config[key]` to read here. What's reported is the version this build of seeya writes and
  // expects, `CONFIG_SCHEMA_VERSION` — the same fact `isEditableConfigKey` below would otherwise
  // mislabel "unknown".
  if (key === 'schemaVersion') {
    return `schemaVersion: ${CONFIG_SCHEMA_VERSION}`;
  }
  if (!isEditableConfigKey(key)) {
    return `seeya config get: ${unknownConfigKeyMessage(key)}`;
  }
  return `${key}: ${formatConfigValue(config[key])}`;
}

export async function runConfigSetCommand(
  context: ConfigCommandContext,
  key: string,
  rawValue: string,
): Promise<string> {
  // S4-T6: same distinction as `runConfigGetCommand` above, checked first so this never reaches
  // `parseConfigFieldUpdate`'s generic "unknown key" branch, which would say `schemaVersion`
  // doesn't exist — it does, it's just not settable.
  if (key === 'schemaVersion') {
    return `seeya config set: ${schemaVersionNotEditableMessage()}`;
  }
  const parsed = parseConfigFieldUpdate(key, rawValue);
  if (!parsed.ok) {
    return `seeya config set: ${parsed.error}`;
  }
  const current = await context.storage.readConfig();
  const updated = applyConfigFieldUpdate(current, parsed.key, parsed.value);
  await context.storage.saveConfig(updated);
  return `${parsed.key} set to ${formatConfigValue(updated[parsed.key])}.`;
}

type BooleanFlagResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'value'; readonly value: boolean }
  | { readonly kind: 'invalid'; readonly error: string };

/** AGENTS.md § "Mensagens de erro": names the received value and the expected shape. Only
 * `"true"`/`"false"` (case-insensitive) are accepted — no truthy-string coercion (`"1"`, `"yes"`),
 * since a policy flag guards D-002's opt-in termination and a lenient parse here would make it
 * too easy to opt in to by accident. */
function parseBooleanFlag(flagName: string, raw: string | undefined): BooleanFlagResult {
  if (raw === undefined) {
    return { kind: 'absent' };
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') {
    return { kind: 'value', value: true };
  }
  if (normalized === 'false') {
    return { kind: 'value', value: false };
  }
  return {
    kind: 'invalid',
    error: `invalid value "${raw}" for ${flagName}; expected "true" or "false"`,
  };
}

export interface ConfigPolicyOptions {
  readonly canTerminate?: string;
  readonly deepCapture?: string;
}

/** No flags at all is a `get` for that one `cwd` — symmetric with `runConfigGetCommand`, and
 * useful on its own: "what is this project's policy right now" is a real question independent of
 * changing it. */
export async function runConfigPolicyCommand(
  context: ConfigCommandContext,
  cwd: string,
  options: ConfigPolicyOptions,
): Promise<string> {
  const current = await context.storage.readConfig();
  if (options.canTerminate === undefined && options.deepCapture === undefined) {
    const policy = current.projectPolicy[cwd] ?? { canTerminate: false, deepCapture: false };
    return renderProjectPolicyLine(cwd, policy);
  }

  const canTerminate = parseBooleanFlag('--can-terminate', options.canTerminate);
  if (canTerminate.kind === 'invalid') {
    return `seeya config policy: ${canTerminate.error}`;
  }
  const deepCapture = parseBooleanFlag('--deep-capture', options.deepCapture);
  if (deepCapture.kind === 'invalid') {
    return `seeya config policy: ${deepCapture.error}`;
  }

  const { config: updated, policy } = applyProjectPolicyUpdate(current, cwd, {
    ...(canTerminate.kind === 'value' ? { canTerminate: canTerminate.value } : {}),
    ...(deepCapture.kind === 'value' ? { deepCapture: deepCapture.value } : {}),
  });
  await context.storage.saveConfig(updated);
  return `Updated policy — ${renderProjectPolicyLine(cwd, policy)}.`;
}
