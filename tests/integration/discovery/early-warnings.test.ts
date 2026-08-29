/**
 * `discoverEarlyWarnings` (S1-T7) against a real filesystem: a fake `~/.claude` for the `.key`
 * listing (`_fixtures.ts`, same as the other discovery suites) plus the real `StorageAdapter`
 * (`adapters/storage/`) pointed at a fresh `tmpdir` for the "already warned" bookkeeping — proving
 * the actual round trip (write once, read back, dedupe) rather than a stand-in's approximation of
 * it (docs/TESTES.md § Integração).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverEarlyWarnings } from '../../../src/adapters/discovery/index.js';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import { createSessionWithPid } from '../../unit/core/_fixtures.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  writeRawSessionFile,
  type DiscoveryFixture,
} from './_fixtures.js';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

describe('discoverEarlyWarnings', () => {
  it('warns once for a session without a transcript, and the second pass does not repeat', async () => {
    fixture = await createDiscoveryFixture();
    const storage = new StorageAdapter(fixture.seeyaHome);
    const session = createSessionWithPid({ hasTranscript: false, lastTranscriptWrite: null });

    const first = await discoverEarlyWarnings([session], {
      claudeHome: fixture.claudeHome,
      storage,
    });
    expect(first.earlyWarnings).toHaveLength(1);
    expect(first.earlyWarnings[0]).toMatchObject({ kind: 'missingTranscript' });

    // Fresh StorageAdapter instance, same seeyaHome: proves persistence, not in-memory reuse.
    const second = await discoverEarlyWarnings([session], {
      claudeHome: fixture.claudeHome,
      storage: new StorageAdapter(fixture.seeyaHome),
    });
    expect(second.earlyWarnings).toStrictEqual([]);
  });

  it('warns once for a .key without a matching .json, and the second pass does not repeat', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, '4242.deadbeef.key', 'sensitive material — never read');
    const storage = new StorageAdapter(fixture.seeyaHome);

    const first = await discoverEarlyWarnings([], { claudeHome: fixture.claudeHome, storage });
    expect(first.earlyWarnings).toHaveLength(1);
    expect(first.earlyWarnings[0]).toMatchObject({
      kind: 'uninspectableSession',
      keyFileName: '4242.deadbeef.key',
    });

    const second = await discoverEarlyWarnings([], {
      claudeHome: fixture.claudeHome,
      storage: new StorageAdapter(fixture.seeyaHome),
    });
    expect(second.earlyWarnings).toStrictEqual([]);
  });

  it('never reads the .key file content, only its name (mode-600 spirit, D-023/D-029)', async () => {
    fixture = await createDiscoveryFixture();
    const secret = 'sensitive material — must not be read';
    await writeRawSessionFile(fixture, '4242.deadbeef.key', secret);
    const storage = new StorageAdapter(fixture.seeyaHome);

    const result = await discoverEarlyWarnings([], { claudeHome: fixture.claudeHome, storage });

    expect(result.earlyWarnings[0]?.message).not.toContain(secret);
    // The fixture file itself is untouched — proves this suite's own assertion isn't the only
    // thing standing between the production code and the secret.
    const stillOnDisk = await readFile(path.join(fixture.sessionsDir, '4242.deadbeef.key'), 'utf8');
    expect(stillOnDisk).toBe(secret);
  });

  it('does not write early-warnings.json at all when nothing new was found (no gratuitous I/O)', async () => {
    fixture = await createDiscoveryFixture();
    const storage = new StorageAdapter(fixture.seeyaHome);

    const result = await discoverEarlyWarnings([], { claudeHome: fixture.claudeHome, storage });

    expect(result.earlyWarnings).toStrictEqual([]);
    await expect(
      readFile(path.join(fixture.seeyaHome, 'early-warnings.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('a malformed .key file name is surfaced in rejected, not silently dropped', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, 'not-a-valid-name.key', 'x');
    const storage = new StorageAdapter(fixture.seeyaHome);

    const result = await discoverEarlyWarnings([], { claudeHome: fixture.claudeHome, storage });

    expect(result.earlyWarnings).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
  });
});
