import { describe, expect, it } from 'vitest';
import {
  resolveSchemaVersion,
  UnsupportedSchemaVersionError,
  type SchemaMigration,
} from '../../../../src/adapters/storage/schema-version.js';

describe('resolveSchemaVersion', () => {
  it('returns the document unchanged when it is already at the expected version', () => {
    const doc = { schemaVersion: 1, endOfDayTime: '19:30' };
    expect(resolveSchemaVersion('doc', doc, {}, 1)).toEqual(doc);
  });

  // Proves the DISPATCH MECHANISM ("reading a document of an old schemaVersion triggers
  // migration", docs/TESTES.md § storage/) using a synthetic migration built only inside this
  // test, independent of the one real production migration (the handoff's v1->v2, D-032 — see
  // adapters/storage/handoff-schema.ts#HANDOFF_SCHEMA_MIGRATIONS and its own dedicated integration
  // coverage in tests/integration/storage/handoff.test.ts). See schema-version.ts's top comment
  // for why every OTHER document still has no migration invented just to exercise one.
  it('applies a registered migration to bring an older document up to the expected version', () => {
    const migrateV1ToV2: SchemaMigration = (document) => ({
      ...document,
      schemaVersion: 2,
      renamedField: document.oldField,
    });
    const doc = { schemaVersion: 1, oldField: 'value' };
    const migrated = resolveSchemaVersion('doc', doc, { 1: migrateV1ToV2 }, 2);
    expect(migrated).toEqual({ schemaVersion: 2, oldField: 'value', renamedField: 'value' });
  });

  it('chains multiple migrations when the document is more than one version behind', () => {
    const v1to2: SchemaMigration = (document) => ({ ...document, schemaVersion: 2 });
    const v2to3: SchemaMigration = (document) => ({ ...document, schemaVersion: 3 });
    const migrated = resolveSchemaVersion('doc', { schemaVersion: 1 }, { 1: v1to2, 2: v2to3 }, 3);
    expect(migrated).toEqual({ schemaVersion: 3 });
  });

  it('refuses a version older than expected with no migration registered for it, instead of reading it as compatible', () => {
    expect(() => resolveSchemaVersion('doc', { schemaVersion: 1 }, {}, 2)).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it('refuses a version NEWER than this build knows about, instead of reading it as compatible', () => {
    expect(() => resolveSchemaVersion('doc', { schemaVersion: 5 }, {}, 1)).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it('refuses a missing schemaVersion the same way', () => {
    expect(() => resolveSchemaVersion('doc', {}, {}, 1)).toThrow(UnsupportedSchemaVersionError);
  });

  it('refuses a non-numeric schemaVersion the same way', () => {
    expect(() => resolveSchemaVersion('doc', { schemaVersion: '1' }, {}, 1)).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it('the error names the document, the version found and the version expected', () => {
    try {
      resolveSchemaVersion('/tmp/config.json', { schemaVersion: 5 }, {}, 1);
      expect.unreachable('expected resolveSchemaVersion to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSchemaVersionError);
      const versionError = error as UnsupportedSchemaVersionError;
      expect(versionError.documentLabel).toBe('/tmp/config.json');
      expect(versionError.foundVersion).toBe(5);
      expect(versionError.expectedVersion).toBe(1);
      expect(versionError.message).toContain('5');
      expect(versionError.message).toContain('1');
    }
  });

  it('throws instead of looping forever when a migration does not advance the version', () => {
    const brokenMigration: SchemaMigration = (document) => document; // forgets to bump schemaVersion
    expect(() =>
      resolveSchemaVersion('doc', { schemaVersion: 1 }, { 1: brokenMigration }, 2),
    ).toThrow(/did not advance/);
  });
});
