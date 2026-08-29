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
import type { Config } from '../../core/types.js';
import { isEnoent } from './fs-errors.js';
import { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, parseConfigDocument } from './config-schema.js';
import { resolveSchemaVersion } from './schema-version.js';

export class StorageAdapter implements Storage {
  constructor(private readonly seeyaHome: string) {}

  async readConfig(): Promise<Config> {
    const configPath = path.join(this.seeyaHome, 'config.json');

    let text: string;
    try {
      text = await readFile(configPath, 'utf8');
    } catch (error) {
      if (isEnoent(error)) {
        // Nothing written yet on this machine (D-025): defaults, not an error.
        return DEFAULT_CONFIG;
      }
      throw new Error(`reading ${configPath} failed: ${String(error)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${configPath} is not valid JSON: ${String(error)}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `${configPath} must be a JSON object at the root, got ` +
          `${Array.isArray(parsed) ? 'an array' : typeof parsed}`,
      );
    }

    // No migration exists yet for config.json (schema-version.ts's top comment explains why the
    // table below is empty, not stubbed). `resolveSchemaVersion` throws
    // `UnsupportedSchemaVersionError` on anything other than exactly `CONFIG_SCHEMA_VERSION`.
    const resolved = resolveSchemaVersion(
      configPath,
      parsed as Record<string, unknown>,
      {},
      CONFIG_SCHEMA_VERSION,
    );
    return parseConfigDocument(resolved);
  }
}
