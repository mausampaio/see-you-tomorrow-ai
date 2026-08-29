/**
 * Generic detect-and-decide mechanism for `schemaVersion` (docs/ARQUITETURA.md § `storage/`:
 * "`schemaVersion` em todo documento persistido, com migração explícita" — no exception per
 * file). `config.json` is the only caller today (S1-T5); this is written so a future document
 * (the handoff, S2-T2; `DayState`, S4-T2) can register its own migrations here instead of
 * reinventing the detection from scratch.
 *
 * **There is only ever version 1 today — no migration is registered for anything.** Writing a
 * fake migration just to have something to exercise in production would be exactly the kind of
 * "affirming what isn't known yet" this project's decisions warn against (D-025's spirit, applied
 * to code instead of data). What's tested (tests/unit/adapters/storage/schema-version.test.ts) is
 * the *mechanism*: given a migrations table (empty in production, a synthetic one built only
 * inside that test), an older version with a registered migration is upgraded step by step to the
 * current version; an older version with no registered migration, or a version newer than this
 * build knows about, is refused outright — never silently read as if it were compatible.
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
