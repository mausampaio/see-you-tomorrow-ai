/**
 * `StorageAdapter#readEarlyWarningState`/`saveEarlyWarningState` (S1-T7) against a real `tmpdir`
 * (docs/TESTES.md § "Integração" — same pattern as `read-config.test.ts`). Every `seeyaHome` here
 * is a freshly made temp directory — never the real `~/.seeya/`.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-early-warnings-'));
}

describe('StorageAdapter#readEarlyWarningState', () => {
  it('returns both sets empty when ~/.seeya/ does not exist at all yet (first run)', async () => {
    const parent = await makeTmpDir();
    try {
      const storage = new StorageAdapter(path.join(parent, 'never-created'));
      const state = await storage.readEarlyWarningState();
      expect(state.notifiedMissingTranscriptSessionIds.size).toBe(0);
      expect(state.notifiedUninspectableSessionKeys.size).toBe(0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('returns both sets empty when the directory exists but early-warnings.json does not', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      const state = await storage.readEarlyWarningState();
      expect(state.notifiedMissingTranscriptSessionIds.size).toBe(0);
      expect(state.notifiedUninspectableSessionKeys.size).toBe(0);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('reads a fully-specified real early-warnings.json correctly', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const document = {
        schemaVersion: 1,
        notifiedMissingTranscriptSessionIds: ['11111111-1111-4111-8111-111111111111'],
        notifiedUninspectableSessionKeys: ['4242.deadbeef.key'],
      };
      await writeFile(
        path.join(seeyaHome, 'early-warnings.json'),
        JSON.stringify(document),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      const state = await storage.readEarlyWarningState();
      expect([...state.notifiedMissingTranscriptSessionIds]).toEqual([
        '11111111-1111-4111-8111-111111111111',
      ]);
      expect([...state.notifiedUninspectableSessionKeys]).toEqual(['4242.deadbeef.key']);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error on a read failure other than "file does not exist"', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await mkdir(path.join(seeyaHome, 'early-warnings.json'));
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readEarlyWarningState()).rejects.toThrow(/reading .* failed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error when early-warnings.json is not valid JSON — never falls back to empty silently', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(path.join(seeyaHome, 'early-warnings.json'), '{not json', 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readEarlyWarningState()).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws instead of silently accepting a schemaVersion newer than this build knows how to read', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'early-warnings.json'),
        JSON.stringify({ schemaVersion: 999 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readEarlyWarningState()).rejects.toThrow(/schemaVersion/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws when a field is present but the wrong shape (a number where a string array is expected)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'early-warnings.json'),
        JSON.stringify({ schemaVersion: 1, notifiedMissingTranscriptSessionIds: 42 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readEarlyWarningState()).rejects.toThrow(/malformed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});

describe('StorageAdapter#saveEarlyWarningState', () => {
  it('writes a file that reads back with the same two sets (round trip)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveEarlyWarningState({
        notifiedMissingTranscriptSessionIds: new Set(['a-session']),
        notifiedUninspectableSessionKeys: new Set(['1.h.key', '2.h.key']),
      });

      const reread = await storage.readEarlyWarningState();
      expect([...reread.notifiedMissingTranscriptSessionIds]).toEqual(['a-session']);
      expect([...reread.notifiedUninspectableSessionKeys].sort()).toEqual(['1.h.key', '2.h.key']);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('creates ~/.seeya/ when it does not exist yet (first write on this machine)', async () => {
    const parent = await makeTmpDir();
    try {
      const seeyaHome = path.join(parent, 'never-created');
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveEarlyWarningState({
        notifiedMissingTranscriptSessionIds: new Set(),
        notifiedUninspectableSessionKeys: new Set(),
      });

      const raw = await readFile(path.join(seeyaHome, 'early-warnings.json'), 'utf8');
      expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1 });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
