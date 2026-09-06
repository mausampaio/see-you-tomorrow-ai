/**
 * `StorageAdapter#saveConfig` against a real `tmpdir` (S4-T4) — the write side of `readConfig`,
 * exercised for real for the first time (`config.json` was read-only in production until this
 * task, per `adapters/storage/atomic-write.ts`'s own module comment).
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import { DEFAULT_CONFIG } from '../../../src/adapters/storage/config-schema.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-save-config-'));
}

describe('StorageAdapter#saveConfig', () => {
  it('writes a config.json that readConfig then reads back identically', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      const updated = { ...DEFAULT_CONFIG, relevanceHours: 6, captureModel: 'opus' };

      await storage.saveConfig(updated);
      const reread = await storage.readConfig();

      expect(reread).toEqual(updated);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('writes atomically (temp file + rename), same mechanism as every other document under ~/.seeya/', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveConfig(DEFAULT_CONFIG);

      const raw = await readFile(path.join(seeyaHome, 'config.json'), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      expect(parsed).toMatchObject({ schemaVersion: 1, captureModel: 'sonnet' });
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('overwrites a previously-written config.json in full — a second save with a different value replaces the whole document', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveConfig({ ...DEFAULT_CONFIG, endOfDayTime: '19:30' });
      await storage.saveConfig({ ...DEFAULT_CONFIG, endOfDayTime: '20:00', relevanceHours: 6 });

      const reread = await storage.readConfig();
      expect(reread.endOfDayTime).toBe('20:00');
      expect(reread.relevanceHours).toBe(6);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('creates ~/.seeya/ if it does not exist yet — same "first write" behavior every other saveX has', async () => {
    const parent = await makeTmpDir();
    try {
      const seeyaHome = path.join(parent, 'never-created');
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveConfig(DEFAULT_CONFIG);
      expect(await storage.readConfig()).toEqual(DEFAULT_CONFIG);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
