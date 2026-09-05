/**
 * `StorageAdapter#readState`/`saveState` (S4-T3, D-006's `estado.json`) against a real `tmpdir` —
 * same pattern `early-warning-state.test.ts` already established.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import { emptyDayState } from '../../../src/core/schedule.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-state-'));
}

describe('StorageAdapter#readState', () => {
  it('returns null when ~/.seeya/ does not exist at all yet (first run)', async () => {
    const parent = await makeTmpDir();
    try {
      const storage = new StorageAdapter(path.join(parent, 'never-created'));
      expect(await storage.readState()).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('returns null when the directory exists but estado.json does not', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.readState()).toBeNull();
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('reads a fully-specified real estado.json correctly, including captureAttemptsToday', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const document = {
        schemaVersion: 1,
        day: '2026-09-05',
        skipped: false,
        snoozeMinutesTotal: 15,
        firedLeadTimesInMinutes: [30],
        endOfDayFired: false,
        captureAttemptsToday: { 'session-a': 2 },
      };
      await writeFile(path.join(seeyaHome, 'estado.json'), JSON.stringify(document), 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.readState()).toStrictEqual({
        day: '2026-09-05',
        skipped: false,
        snoozeMinutesTotal: 15,
        firedLeadTimesInMinutes: [30],
        endOfDayFired: false,
        captureAttemptsToday: { 'session-a': 2 },
      });
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('defaults captureAttemptsToday to {} when the document omits it (older/hand-edited file)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const document = {
        schemaVersion: 1,
        day: '2026-09-05',
        skipped: false,
        snoozeMinutesTotal: 0,
        firedLeadTimesInMinutes: [],
        endOfDayFired: false,
      };
      await writeFile(path.join(seeyaHome, 'estado.json'), JSON.stringify(document), 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      const state = await storage.readState();
      expect(state?.captureAttemptsToday).toStrictEqual({});
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error on a read failure other than "file does not exist"', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await mkdir(path.join(seeyaHome, 'estado.json'));
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readState()).rejects.toThrow(/reading .* failed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error when estado.json is not valid JSON — never falls back to a fresh day silently', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(path.join(seeyaHome, 'estado.json'), '{not json', 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readState()).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws instead of silently accepting a schemaVersion newer than this build knows how to read', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'estado.json'),
        JSON.stringify({ schemaVersion: 999 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readState()).rejects.toThrow(/schemaVersion/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws when a field is present but the wrong shape (a string where a boolean is expected)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeFile(
        path.join(seeyaHome, 'estado.json'),
        JSON.stringify({
          schemaVersion: 1,
          day: '2026-09-05',
          skipped: 'yes',
          snoozeMinutesTotal: 0,
          firedLeadTimesInMinutes: [],
          endOfDayFired: false,
        }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readState()).rejects.toThrow(/malformed/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});

describe('StorageAdapter#saveState', () => {
  it('writes a file that reads back with the exact same DayState (round trip)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      const state = {
        ...emptyDayState('2026-09-05'),
        snoozeMinutesTotal: 30,
        captureAttemptsToday: { 'session-a': 1, 'session-b': 3 },
      };
      await storage.saveState(state);
      expect(await storage.readState()).toStrictEqual(state);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('creates ~/.seeya/ when it does not exist yet (first write on this machine)', async () => {
    const parent = await makeTmpDir();
    try {
      const seeyaHome = path.join(parent, 'never-created');
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveState(emptyDayState('2026-09-05'));

      const raw = await readFile(path.join(seeyaHome, 'estado.json'), 'utf8');
      expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1, day: '2026-09-05' });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('a later save fully replaces the previous document (not a merge)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveState({
        ...emptyDayState('2026-09-05'),
        captureAttemptsToday: { 'session-a': 5 },
      });
      await storage.saveState(emptyDayState('2026-09-05'));
      expect(await storage.readState()).toStrictEqual(emptyDayState('2026-09-05'));
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});
