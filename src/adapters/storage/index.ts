/**
 * Storage adapter: implements the `Storage` port (`core/ports.ts`) against `~/.seeya/` (D-027).
 * The root is injected into the constructor — never read from `os.homedir()` inside this module —
 * so every test here runs against a `tmpdir`, never the real `~/.seeya/` (AGENTS.md § "Regras que
 * não se negociam"). `cli/` is the only place that resolves the real root and constructs this
 * class (D-020).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Storage } from '../../core/ports.js';
import type { Config, EarlyWarningState } from '../../core/types.js';
import { EMPTY_EARLY_WARNING_STATE } from '../../core/early-warnings.js';
import { isEnoent } from './fs-errors.js';
import { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, parseConfigDocument } from './config-schema.js';
import {
  EARLY_WARNING_SCHEMA_VERSION,
  parseEarlyWarningDocument,
  serializeEarlyWarningState,
} from './early-warning-schema.js';
import { resolveSchemaVersion } from './schema-version.js';
import { writeFileAtomic } from './atomic-write.js';

/**
 * Reads `filePath`, parses it as JSON, confirms the root is a plain object, and resolves its
 * `schemaVersion` against `expectedVersion` (`schema-version.ts`) — the boilerplate every document
 * under `~/.seeya/` repeats before its own schema ever sees it. Extracted in S1-T7 when
 * `readEarlyWarningState` below would otherwise have duplicated `readConfig`'s parsing verbatim
 * (AGENTS.md § "Nada de duplicação"); `readConfig`'s own tests
 * (tests/integration/storage/read-config.test.ts) are what proves the extraction didn't change its
 * behavior.
 *
 * Returns `null` when the file doesn't exist yet (D-025: absence, not corruption) — deciding what
 * "nothing written yet" resolves to is each caller's own job, because `readConfig`'s empty
 * defaults and `readEarlyWarningState`'s empty sets aren't the same shape.
 */
async function readVersionedDocument(
  filePath: string,
  expectedVersion: number,
): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isEnoent(error)) {
      return null;
    }
    throw new Error(`reading ${filePath} failed: ${String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${filePath} must be a JSON object at the root, got ` +
        `${Array.isArray(parsed) ? 'an array' : typeof parsed}`,
    );
  }

  // No migration exists yet for either document at version 1 (schema-version.ts's top comment
  // explains why the table below is empty, not stubbed). `resolveSchemaVersion` throws
  // `UnsupportedSchemaVersionError` on anything other than exactly `expectedVersion`.
  return resolveSchemaVersion(filePath, parsed as Record<string, unknown>, {}, expectedVersion);
}

export class StorageAdapter implements Storage {
  constructor(private readonly seeyaHome: string) {}

  async readConfig(): Promise<Config> {
    const configPath = path.join(this.seeyaHome, 'config.json');
    const resolved = await readVersionedDocument(configPath, CONFIG_SCHEMA_VERSION);
    if (resolved === null) {
      // Nothing written yet on this machine (D-025): defaults, not an error.
      return DEFAULT_CONFIG;
    }
    return parseConfigDocument(resolved);
  }

  async readEarlyWarningState(): Promise<EarlyWarningState> {
    const filePath = path.join(this.seeyaHome, 'early-warnings.json');
    const resolved = await readVersionedDocument(filePath, EARLY_WARNING_SCHEMA_VERSION);
    if (resolved === null) {
      // Nothing warned about yet on this machine (D-025): both sets empty, not an error.
      return EMPTY_EARLY_WARNING_STATE;
    }
    return parseEarlyWarningDocument(resolved);
  }

  async saveEarlyWarningState(state: EarlyWarningState): Promise<void> {
    const filePath = path.join(this.seeyaHome, 'early-warnings.json');
    await writeFileAtomic(filePath, JSON.stringify(serializeEarlyWarningState(state)));
  }
}
