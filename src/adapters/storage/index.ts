/**
 * Storage adapter: implements the `Storage` port (`core/ports.ts`) against `~/.seeya/` (D-027).
 * The root is injected into the constructor — never read from `os.homedir()` inside this module —
 * so every test here runs against a `tmpdir`, never the real `~/.seeya/` (AGENTS.md § "Regras que
 * não se negociam"). `cli/` is the only place that resolves the real root and constructs this
 * class (D-020).
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Briefing, RejectedDiscoveryRecord, Storage } from '../../core/ports.js';
import type { Config, Day, EarlyWarningState, Handoff } from '../../core/types.js';
import { EMPTY_EARLY_WARNING_STATE } from '../../core/early-warnings.js';
import { isEnoent } from './fs-errors.js';
import { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, parseConfigDocument } from './config-schema.js';
import {
  EARLY_WARNING_SCHEMA_VERSION,
  parseEarlyWarningDocument,
  serializeEarlyWarningState,
} from './early-warning-schema.js';
import {
  HANDOFF_SCHEMA_VERSION,
  parseHandoffDocument,
  serializeHandoff,
} from './handoff-schema.js';
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

/**
 * Lists `dir`'s `.json` file names, or — instead of throwing — one `RejectedDiscoveryRecord`
 * describing a directory-level failure (e.g. the path exists but isn't a directory). Same shape
 * `adapters/discovery/registry.ts#listSessionJsonFilesOrRejection` already uses for the identical
 * problem: a listing failure worse than "doesn't exist yet" degrades to one named rejection
 * instead of aborting `listHandoffs` and losing every other handoff the day actually has.
 */
async function listJsonFilesOrRejection(dir: string): Promise<string[] | RejectedDiscoveryRecord> {
  try {
    const entries = await readdir(dir);
    return entries.filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    return { file: dir, raw: undefined, reason: `listing ${dir} failed: ${String(error)}` };
  }
}

/**
 * Reads and validates one handoff file for `Storage#listHandoffs`. `null` means the file vanished
 * between `readdir` and this read — a benign race (something else cleaned it up mid-listing), not
 * a corruption, so it's silently skipped rather than reported (D-025: no claim either way about a
 * file that no longer exists). Any other failure — bad JSON, a schema mismatch, an unsupported
 * `schemaVersion` — becomes a `RejectedDiscoveryRecord` instead of throwing, which is what lets
 * `listHandoffs` keep going through every other file (D-022).
 */
async function readOneHandoffOrRejection(
  filePath: string,
): Promise<Handoff | RejectedDiscoveryRecord | null> {
  try {
    const resolved = await readVersionedDocument(filePath, HANDOFF_SCHEMA_VERSION);
    return resolved === null ? null : parseHandoffDocument(resolved);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { file: filePath, raw: undefined, reason };
  }
}

function isRejection(
  value: Handoff | RejectedDiscoveryRecord | null,
): value is RejectedDiscoveryRecord {
  return value !== null && 'reason' in value;
}

/** Splits `readOneHandoffOrRejection`'s per-file outcomes into the two sides D-022 requires,
 * dropping the benign "vanished mid-listing" `null`s silently (see that function's docstring). */
function partitionHandoffOutcomes(
  outcomes: readonly (Handoff | RejectedDiscoveryRecord | null)[],
  rejectedSoFar: readonly RejectedDiscoveryRecord[],
): { handoffs: Handoff[]; rejected: RejectedDiscoveryRecord[] } {
  const handoffs: Handoff[] = [];
  const rejected: RejectedDiscoveryRecord[] = [...rejectedSoFar];
  for (const outcome of outcomes) {
    if (outcome === null) {
      continue;
    }
    if (isRejection(outcome)) {
      rejected.push(outcome);
    } else {
      handoffs.push(outcome);
    }
  }
  return { handoffs, rejected };
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

  private sessionsDir(day: Day): string {
    return path.join(this.seeyaHome, 'days', day, 'sessions');
  }

  /** `~/.seeya/days/<day>/sessions/<sessionId>.json` (docs/ESPECIFICACAO.md § "Formato do
   * handoff") — `node:path` throughout, never a literal `/`/`\` join (AGENTS.md § "Sistema de
   * arquivos"). */
  private handoffPath(day: Day, sessionId: string): string {
    return path.join(this.sessionsDir(day), `${sessionId}.json`);
  }

  async saveHandoff(day: Day, handoff: Handoff): Promise<void> {
    await writeFileAtomic(
      this.handoffPath(day, handoff.sessionId),
      JSON.stringify(serializeHandoff(handoff)),
    );
  }

  async readHandoff(day: Day, sessionId: string): Promise<Handoff | null> {
    const filePath = this.handoffPath(day, sessionId);
    const resolved = await readVersionedDocument(filePath, HANDOFF_SCHEMA_VERSION);
    if (resolved === null) {
      // No capture made today for this session yet (D-025): normal, not an error.
      return null;
    }
    return parseHandoffDocument(resolved);
  }

  /** `~/.seeya/days/<day>/summary.md` (docs/ESPECIFICACAO.md § "Formato do handoff": "ao lado da
   * pasta `sessions/`"). */
  private briefingPath(day: Day): string {
    return path.join(this.seeyaHome, 'days', day, 'summary.md');
  }

  async listHandoffs(
    day: Day,
  ): Promise<{ handoffs: Handoff[]; rejected: RejectedDiscoveryRecord[] }> {
    const dir = this.sessionsDir(day);
    const namesOrRejection = await listJsonFilesOrRejection(dir);
    const fileNames = Array.isArray(namesOrRejection) ? namesOrRejection : [];
    const rejectedSoFar = Array.isArray(namesOrRejection) ? [] : [namesOrRejection];

    const outcomes = await Promise.all(
      fileNames.map((name) => readOneHandoffOrRejection(path.join(dir, name))),
    );
    return partitionHandoffOutcomes(outcomes, rejectedSoFar);
  }

  async saveBriefing(day: Day, markdown: string): Promise<void> {
    await writeFileAtomic(this.briefingPath(day), markdown);
  }

  /** S3-T1: no second read path, no new on-disk format — `listHandoffs` already does the real
   * work; this only decides what "nothing for this day" means (D-025, see `Briefing`'s own
   * docstring in `core/ports.ts`). */
  async readBriefing(day: Day): Promise<Briefing | null> {
    const { handoffs, rejected } = await this.listHandoffs(day);
    if (handoffs.length === 0 && rejected.length === 0) {
      // Nothing captured for this day at all (D-025): absence, not an empty briefing.
      return null;
    }
    return { day, handoffs, rejected };
  }
}
