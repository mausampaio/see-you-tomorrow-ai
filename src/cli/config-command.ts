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
 *
 * **`policy`'s `cwd` argument (S4-T12, docs/QUESTOES.md Q-056 item 3):** resolved if relative
 * (`resolvePolicyCwdArgument`) and matched/written through the normalized criterion
 * `application/eligibility-assembly.ts#projectPolicyFor`/`adapters/storage/config-schema.ts
 * #applyProjectPolicyUpdate` already use for `ignore` — see both functions' own docstrings. Before
 * this task, `policy`'s `cwd` was compared and stored as a raw string, so a spelling different from
 * whatever a discovered session's `cwd` happened to be (separator, case, a trailing slash, or a
 * relative path) made `canTerminate`/`deepCapture` silently never apply.
 */
import path from 'node:path';
import {
  applyConfigFieldUpdate,
  applyProjectPolicyUpdate,
  CONFIG_SCHEMA_VERSION,
  EDITABLE_CONFIG_KEYS,
  formatConfigValue,
  isEditableConfigKey,
  parseConfigFieldUpdate,
  projectPolicyNotEditableMessage,
  schemaVersionNotEditableMessage,
  unknownConfigKeyMessage,
} from '../adapters/storage/config-schema.js';
import { projectPolicyFor } from '../application/eligibility-assembly.js';
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
  // S4-T8 item 3: identical reasoning, for the other name `isEditableConfigKey` also refuses.
  // `projectPolicy` exists (`runConfigGetCommand` above already reads it) — it just needs
  // `seeya config policy <cwd>`, not this command, so it gets the same "exists, wrong tool" message
  // instead of falling into `parseConfigFieldUpdate`'s generic "unknown key" branch.
  if (key === 'projectPolicy') {
    return `seeya config set: ${projectPolicyNotEditableMessage()}`;
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

/**
 * A `cwd` absolute under EITHER path convention (`c:\...`/`c:/...`, or `/...`) is left exactly as
 * typed — checking both, not just the host's own, means an already-absolute key written on a
 * different OS (D-032's own concern) is never mistaken for "relative" just because it doesn't
 * match the CURRENT host's convention. `path.win32`/`path.posix` are pure string utilities (unlike
 * bare `path.isAbsolute`, they never read `process.platform`), so this check itself needs no
 * platform parameter at all.
 */
function looksAbsolute(cwd: string): boolean {
  return path.win32.isAbsolute(cwd) || path.posix.isAbsolute(cwd);
}

/**
 * S4-T12 (docs/QUESTOES.md Q-056 item 3, cuidado (b)): a relative `cwd` typed into
 * `seeya config policy` would never match the absolute `cwd` a discovered session always carries —
 * resolved against the CLI's own working directory (`path.resolve`; `cli/` is the composition root,
 * D-020, the one place that knows it) rather than refused, per the PO's call recorded in
 * docs/QUESTOES.md Q-065: resolving is what the person meant, and the confirmation
 * (`runConfigPolicyCommand` below) shows the absolute path that actually got written.
 *
 * `cliWorkingDirectory` defaults to the real `process.cwd()` — exported and parameterized (not a
 * bare call inside the function body) so a test can inject a fixed base directory instead of
 * depending on wherever the test runner happens to execute from, same discipline `Clock`/`platform`
 * already get elsewhere in this project (D-019, `core/cwd-normalization.ts`).
 */
export function resolvePolicyCwdArgument(
  cwd: string,
  cliWorkingDirectory: string = process.cwd(),
): string {
  return looksAbsolute(cwd) ? cwd : path.resolve(cliWorkingDirectory, cwd);
}

/** No flags at all is a `get` for that one `cwd` — symmetric with `runConfigGetCommand`, and
 * useful on its own: "what is this project's policy right now" is a real question independent of
 * changing it. */
export async function runConfigPolicyCommand(
  context: ConfigCommandContext,
  cwd: string,
  options: ConfigPolicyOptions,
): Promise<string> {
  const resolvedCwd = resolvePolicyCwdArgument(cwd);
  const current = await context.storage.readConfig();
  if (options.canTerminate === undefined && options.deepCapture === undefined) {
    // S4-T12: normalized lookup (`projectPolicyFor`), not a raw `current.projectPolicy[cwd]` read —
    // so this reports the policy that will actually APPLY to a session at this `cwd`, matching a
    // raw key already on disk regardless of separator/case/trailing-slash spelling.
    const policy = projectPolicyFor(current, resolvedCwd);
    return renderProjectPolicyLine(resolvedCwd, policy);
  }

  const canTerminate = parseBooleanFlag('--can-terminate', options.canTerminate);
  if (canTerminate.kind === 'invalid') {
    return `seeya config policy: ${canTerminate.error}`;
  }
  const deepCapture = parseBooleanFlag('--deep-capture', options.deepCapture);
  if (deepCapture.kind === 'invalid') {
    return `seeya config policy: ${deepCapture.error}`;
  }

  const {
    config: updated,
    policy,
    canonicalCwd,
  } = applyProjectPolicyUpdate(current, resolvedCwd, {
    ...(canTerminate.kind === 'value' ? { canTerminate: canTerminate.value } : {}),
    ...(deepCapture.kind === 'value' ? { deepCapture: deepCapture.value } : {}),
  });
  await context.storage.saveConfig(updated);
  // `canonicalCwd` (not the raw `cwd` argument) — cuidado (b): the confirmation shows the absolute,
  // canonicalized path that was actually written, not what the person typed.
  return `Updated policy — ${renderProjectPolicyLine(canonicalCwd, policy)}.`;
}
