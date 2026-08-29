/**
 * `StorageAdapter#readConfig` against a real `tmpdir` (docs/TESTES.md § "Integração"). Every
 * `seeyaHome` here is a freshly made temp directory — never the real `~/.seeya/`.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import { DEFAULT_CONFIG } from '../../../src/adapters/storage/config-schema.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-config-'));
}

describe('StorageAdapter#readConfig', () => {
  it('returns every default when ~/.seeya/ does not exist at all yet (first run)', async () => {
    const parent = await makeTmpDir();
    try {
      const seeyaHome = path.join(parent, 'never-created');
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.readConfig()).toEqual(DEFAULT_CONFIG);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('returns every default when the directory exists but config.json does not', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.readConfig()).toEqual(DEFAULT_CONFIG);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('reads a fully-specified real config.json correctly', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const document = {
        schemaVersion: 1,
        endOfDayTime: '19:30',
        leadTimesInMinutes: [30, 15],
        relevanceHours: 12,
        idleMinutes: 45,
        captureModel: 'sonnet',
        budgetPerSessionUsd: 0.25,
        captureConcurrency: 3,
        ignore: ['c:\\code\\rascunhos'],
        projectPolicy: { 'c:\\code\\projeto': { canTerminate: true } },
      };
      await writeFile(path.join(seeyaHome, 'config.json'), JSON.stringify(document), 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      const config = await storage.readConfig();
      expect(config.endOfDayTime).toBe('19:30');
      expect(config.ignore).toEqual(['c:\\code\\rascunhos']);
      expect(config.projectPolicy).toEqual({
        'c:\\code\\projeto': { canTerminate: true, deepCapture: false },
      });
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('fills in defaults for a partial config.json that only sets a couple of fields', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'config.json'),
        JSON.stringify({ schemaVersion: 1, relevanceHours: 6 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      const config = await storage.readConfig();
      expect(config.relevanceHours).toBe(6);
      expect(config.idleMinutes).toBe(DEFAULT_CONFIG.idleMinutes);
      expect(config.endOfDayTime).toBe(DEFAULT_CONFIG.endOfDayTime);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error on a read failure other than "file does not exist" (e.g. config.json is a directory)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      // Reading a directory as if it were a file fails with EISDIR, not ENOENT — the read-side
      // counterpart to atomic-write.test.ts's "rename target is a directory" case: neither is
      // "nothing written yet" (D-025's exemption), so neither should resolve to defaults.
      await mkdir(path.join(seeyaHome, 'config.json'));
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readConfig()).rejects.toThrow(/reading .* failed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error when config.json is not valid JSON — never falls back to defaults silently', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(path.join(seeyaHome, 'config.json'), '{not json', 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readConfig()).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error when config.json is a JSON array instead of an object', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(path.join(seeyaHome, 'config.json'), '[1,2,3]', 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readConfig()).rejects.toThrow(/must be a JSON object/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error when config.json has a field of the wrong type — never falls back to defaults silently', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'config.json'),
        JSON.stringify({ schemaVersion: 1, relevanceHours: 'twelve' }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readConfig()).rejects.toThrow(/malformed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws instead of silently accepting a schemaVersion newer than this build knows how to read', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'config.json'),
        JSON.stringify({ schemaVersion: 999 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readConfig()).rejects.toThrow(/schemaVersion/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws when schemaVersion is entirely missing from an otherwise well-formed file', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'config.json'),
        JSON.stringify({ relevanceHours: 12 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readConfig()).rejects.toThrow(/schemaVersion/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});
