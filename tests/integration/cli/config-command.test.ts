/**
 * `runConfigGetCommand`/`runConfigSetCommand`/`runConfigPolicyCommand` against a REAL
 * `StorageAdapter` over a `tmpdir` — proves the write really lands on `config.json` and a
 * completely fresh `StorageAdapter` (a later `seeya config get`, or the daemon's own next poll)
 * reads it back, and that `config.json` not existing yet still resolves to defaults (D-025)
 * before the first `seeya config set` ever runs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import {
  runConfigGetCommand,
  runConfigPolicyCommand,
  runConfigSetCommand,
} from '../../../src/cli/config-command.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  type DiscoveryFixture,
} from '../discovery/_fixtures.js';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

describe('config-command against a real StorageAdapter', () => {
  it('get, before any config.json exists, reports every default (D-025: absence is not an error)', async () => {
    fixture = await createDiscoveryFixture();
    const storage = new StorageAdapter(fixture.seeyaHome);

    const report = await runConfigGetCommand({ storage }, 'relevanceHours');
    expect(report).toBe('relevanceHours: 12');
  });

  it('a value set by one Storage instance is read back by a brand-new one', async () => {
    fixture = await createDiscoveryFixture();
    await runConfigSetCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      'relevanceHours',
      '6',
    );

    const report = await runConfigGetCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      'relevanceHours',
    );
    expect(report).toBe('relevanceHours: 6');
  });

  it('a second `set` on a different key does not clobber the first one already on disk', async () => {
    fixture = await createDiscoveryFixture();
    await runConfigSetCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      'relevanceHours',
      '6',
    );
    await runConfigSetCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      'captureModel',
      'opus',
    );

    const report = await runConfigGetCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      undefined,
    );
    expect(report).toContain('relevanceHours: 6');
    expect(report).toContain('captureModel: opus');
  });

  it('an invalid `set` never creates config.json at all', async () => {
    fixture = await createDiscoveryFixture();
    await runConfigSetCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      'relevanceHours',
      'not-a-number',
    );

    // Still reads as defaults — the invalid write never landed.
    const report = await runConfigGetCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      undefined,
    );
    expect(report).toContain('relevanceHours: 12');
  });

  it('policy set by one instance is visible to another, and other projects are untouched', async () => {
    fixture = await createDiscoveryFixture();
    await runConfigPolicyCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      'c:\\code\\a',
      {
        canTerminate: 'true',
      },
    );
    await runConfigPolicyCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      'c:\\code\\b',
      {
        deepCapture: 'true',
      },
    );

    const report = await runConfigGetCommand(
      { storage: new StorageAdapter(fixture.seeyaHome) },
      'projectPolicy',
    );
    expect(report).toContain('c:\\code\\a: canTerminate=true, deepCapture=false');
    expect(report).toContain('c:\\code\\b: canTerminate=false, deepCapture=true');
  });
});
