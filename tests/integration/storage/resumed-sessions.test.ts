/**
 * `StorageAdapter#readResumedSessionIds`/`saveResumedSessionIds` (S3-T3) against a real `tmpdir`
 * (docs/TESTES.md § "Integração" — same pattern as `early-warning-state.test.ts`). Every
 * `seeyaHome` here is a freshly made temp directory — never the real `~/.seeya/`.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-resumed-'));
}

describe('StorageAdapter#readResumedSessionIds', () => {
  it('returns an empty set when ~/.seeya/ does not exist at all yet', async () => {
    const parent = await makeTmpDir();
    try {
      const storage = new StorageAdapter(path.join(parent, 'never-created'));
      const ids = await storage.readResumedSessionIds('2026-08-16');
      expect(ids.size).toBe(0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('returns an empty set when the day exists but resumed.json does not', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await mkdir(path.join(seeyaHome, 'days', '2026-08-16', 'sessions'), { recursive: true });
      const storage = new StorageAdapter(seeyaHome);
      const ids = await storage.readResumedSessionIds('2026-08-16');
      expect(ids.size).toBe(0);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('reads a real resumed.json correctly', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dayDir = path.join(seeyaHome, 'days', '2026-08-16');
      await mkdir(dayDir, { recursive: true });
      await writeFile(
        path.join(dayDir, 'resumed.json'),
        JSON.stringify({
          schemaVersion: 1,
          sessionIds: ['11111111-1111-4111-8111-111111111111'],
        }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      const ids = await storage.readResumedSessionIds('2026-08-16');
      expect([...ids]).toEqual(['11111111-1111-4111-8111-111111111111']);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('does not confuse one day with another — each day has its own resumed.json', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveResumedSessionIds('2026-08-16', new Set(['only-in-16']));
      const otherDay = await storage.readResumedSessionIds('2026-08-17');
      expect(otherDay.size).toBe(0);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error when resumed.json is not valid JSON — never falls back to empty silently', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dayDir = path.join(seeyaHome, 'days', '2026-08-16');
      await mkdir(dayDir, { recursive: true });
      await writeFile(path.join(dayDir, 'resumed.json'), '{not json', 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readResumedSessionIds('2026-08-16')).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws instead of silently accepting a schemaVersion newer than this build knows how to read', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dayDir = path.join(seeyaHome, 'days', '2026-08-16');
      await mkdir(dayDir, { recursive: true });
      await writeFile(
        path.join(dayDir, 'resumed.json'),
        JSON.stringify({ schemaVersion: 999 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readResumedSessionIds('2026-08-16')).rejects.toThrow(/schemaVersion/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws when sessionIds is present but the wrong shape', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dayDir = path.join(seeyaHome, 'days', '2026-08-16');
      await mkdir(dayDir, { recursive: true });
      await writeFile(
        path.join(dayDir, 'resumed.json'),
        JSON.stringify({ schemaVersion: 1, sessionIds: 42 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readResumedSessionIds('2026-08-16')).rejects.toThrow(/malformed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});

describe('StorageAdapter#saveResumedSessionIds', () => {
  it('writes a file that reads back with the same set (round trip)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveResumedSessionIds(
        '2026-08-16',
        new Set(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']),
      );

      const reread = await storage.readResumedSessionIds('2026-08-16');
      expect([...reread].sort()).toEqual([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ]);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('creates ~/.seeya/days/<day>/ when it does not exist yet (first resume of the day)', async () => {
    const parent = await makeTmpDir();
    try {
      const seeyaHome = path.join(parent, 'never-created');
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveResumedSessionIds('2026-08-16', new Set());

      const raw = await readFile(
        path.join(seeyaHome, 'days', '2026-08-16', 'resumed.json'),
        'utf8',
      );
      expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1, sessionIds: [] });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('overwrites, rather than merges — the caller is responsible for passing the full set', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveResumedSessionIds('2026-08-16', new Set(['first']));
      await storage.saveResumedSessionIds('2026-08-16', new Set(['second']));

      const reread = await storage.readResumedSessionIds('2026-08-16');
      expect([...reread]).toEqual(['second']);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});
