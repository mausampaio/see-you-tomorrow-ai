/**
 * Generic detect-and-decide mechanism for `schemaVersion` (docs/ARQUITETURA.md § `storage/`:
 * "`schemaVersion` em todo documento persistido, com migração explícita" — no exception per
 * file). `config.json` was the only caller for a long time (S1-T5); this was written so a future
 * document could register its own migrations here instead of reinventing the detection from
 * scratch, and the handoff (D-032, S4-T0) is the first one that actually needed to.
 *
 * **`config.json`/`early-warnings.json`/`resumed.json` still have no migration registered at
 * all — only version 1 has ever existed for those.** Writing a fake migration for them just to
 * have something to exercise in production would be exactly the kind of "affirming what isn't
 * known yet" this project's decisions warn against (D-025's spirit, applied to code instead of
 * data). **The handoff is the exception**: `HANDOFF_SCHEMA_VERSION` moved 1 → 2 under D-032 (`git`
 * became a list), and `adapters/storage/handoff-schema.ts#HANDOFF_SCHEMA_MIGRATIONS` registers the
 * real migration this mechanism was built to eventually carry. What's tested here
 * (tests/unit/adapters/storage/schema-version.test.ts) is still the *mechanism* in isolation, with
 * its own synthetic migrations — the handoff's real one has its own dedicated integration coverage
 * (`tests/integration/storage/handoff.test.ts`, "D-032 migration from schemaVersion 1") against an
 * actual file on disk, not a migrations table built inline: an older version with a registered
 * migration is upgraded step by step to the current version; an older version with no registered
 * migration, or a version newer than this build knows about, is refused outright — never silently
 * read as if it were compatible.
 */

export type SchemaMigration = (document: Record<string, unknown>) => Record<string, unknown>;

function describeVersion(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

/**
 * Thrown by `resolveSchemaVersion` when `document`'s `schemaVersion` can't be reconciled with
 * `expectedVersion` — either it's newer than anything this build knows how to read, or it's older
 * and no migration is registered to bring it forward from there. Carries both values (AGENTS.md §
 * "Mensagens de erro": the message alone doesn't tell a caller which of the two happened).
 */
export class UnsupportedSchemaVersionError extends Error {
  constructor(
    readonly documentLabel: string,
    readonly foundVersion: unknown,
    readonly expectedVersion: number,
  ) {
    super(
      `${documentLabel} has schemaVersion ${describeVersion(foundVersion)}, but this build ` +
        `only knows how to read up to version ${expectedVersion} and has no migration ` +
        `registered to reach it from there. Refusing to read it as if it were compatible.`,
    );
    this.name = 'UnsupportedSchemaVersionError';
  }
}

/**
 * Detects `document`'s `schemaVersion` against `expectedVersion` and decides what to do:
 * already current → returned unchanged; older, with a migration registered for its exact version
 * → migrated forward one step at a time until it reaches `expectedVersion`; anything else
 * (an unregistered older version, a non-numeric/missing `schemaVersion`, or a version newer than
 * `expectedVersion`) → throws `UnsupportedSchemaVersionError` rather than guessing.
 *
 * `migrations` is a parameter, not a module-level constant, specifically so a test can hand this
 * function a synthetic migration without that migration ever existing in production code (see
 * this file's top comment) — production callers always pass their own real table (today: empty).
 */
export function resolveSchemaVersion(
  documentLabel: string,
  document: Record<string, unknown>,
  migrations: Readonly<Record<number, SchemaMigration>>,
  expectedVersion: number,
): Record<string, unknown> {
  let current = document;
  let version = current.schemaVersion;
  while (version !== expectedVersion) {
    const migrate = typeof version === 'number' ? migrations[version] : undefined;
    if (migrate === undefined) {
      throw new UnsupportedSchemaVersionError(documentLabel, version, expectedVersion);
    }
    const migrated = migrate(current);
    const nextVersion = migrated.schemaVersion;
    if (nextVersion === version) {
      // A migration that doesn't advance the version would loop forever. Only a bug in a future
      // migration function can cause this — never user data — so it's an assertion, not a
      // data-shaped error with its own visible-to-the-user message.
      throw new Error(
        `migration registered for schemaVersion ${describeVersion(version)} of ` +
          `${documentLabel} did not advance the version — refusing to loop`,
      );
    }
    current = migrated;
    version = nextVersion;
  }
  return current;
}
