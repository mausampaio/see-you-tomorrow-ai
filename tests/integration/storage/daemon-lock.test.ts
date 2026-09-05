/**
 * `StorageAdapter#readDaemonLock`/`writeDaemonLock`/`clearDaemonLock` (S4-T3, D-005's
 * `daemon.lock`) against a real `tmpdir` — same pattern `early-warning-state.test.ts` established.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-daemon-lock-'));
}

describe('StorageAdapter#readDaemonLock', () => {
  it('returns null when ~/.seeya/ does not exist at all yet', async () => {
    const parent = await makeTmpDir();
    try {
      const storage = new StorageAdapter(path.join(parent, 'never-created'));
      expect(await storage.readDaemonLock()).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('reads a real daemon.lock correctly', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'daemon.lock'),
        JSON.stringify({ schemaVersion: 1, pid: 4242, startedAt: '2026-09-05T10:00:00.000Z' }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.readDaemonLock()).toStrictEqual({
        pid: 4242,
        startedAt: new Date('2026-09-05T10:00:00.000Z'),
      });
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error on a read failure other than "file does not exist"', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await mkdir(path.join(seeyaHome, 'daemon.lock'));
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readDaemonLock()).rejects.toThrow(/reading .* failed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws when pid is not a positive integer — never silently accepted', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'daemon.lock'),
        JSON.stringify({ schemaVersion: 1, pid: -1, startedAt: '2026-09-05T10:00:00.000Z' }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readDaemonLock()).rejects.toThrow(/malformed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});

describe('StorageAdapter#writeDaemonLock / clearDaemonLock', () => {
  it('writes a lock that reads back identically (round trip)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      const lock = { pid: 555, startedAt: new Date('2026-09-05T10:00:00.000Z') };
      await storage.writeDaemonLock(lock);
      expect(await storage.readDaemonLock()).toStrictEqual(lock);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('a later write fully replaces the previous lock (not a merge, and not two files)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.writeDaemonLock({ pid: 111, startedAt: new Date('2026-09-01T00:00:00.000Z') });
      const secondLock = { pid: 222, startedAt: new Date('2026-09-05T10:00:00.000Z') };
      await storage.writeDaemonLock(secondLock);
      expect(await storage.readDaemonLock()).toStrictEqual(secondLock);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('clearDaemonLock removes the file — a later read sees null again', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.writeDaemonLock({ pid: 555, startedAt: new Date('2026-09-05T10:00:00.000Z') });
      await storage.clearDaemonLock();
      expect(await storage.readDaemonLock()).toBeNull();
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('clearDaemonLock on an already-absent lock does not throw (D-025)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.clearDaemonLock()).resolves.toBeUndefined();
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});
