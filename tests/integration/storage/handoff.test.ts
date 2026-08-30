/**
 * `StorageAdapter#saveHandoff`/`readHandoff` against a real `tmpdir` (docs/TESTES.md §
 * "Integração"). Every `seeyaHome` here is a freshly made temp directory — never the real
 * `~/.seeya/`.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import type { Handoff } from '../../../src/core/types.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-handoff-'));
}

const SAMPLE_HANDOFF: Handoff = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  cwd: 'c:\\code\\projeto',
  name: 'projeto-01',
  capturedAt: new Date('2026-08-16T21:00:04.120Z'),
  sessionState: 'ended',
  capturedDuringActiveTurn: false,
  source: 'model',
  captureMode: 'lean',
  sources: ['git', 'transcript', 'registry'],
  facts: {
    lastActivity: new Date('2026-08-16T20:41:11.000Z'),
    lastPrompts: ['do the thing'],
    touchedFiles: ['src/a.ts'],
    git: {
      branch: 'main',
      dirty: true,
      modifiedFiles: ['src/a.ts'],
      commitsToday: [{ sha: '1b7fd99', title: 'docs: especificação inicial' }],
      worktrees: [
        {
          path: 'c:\\code\\projeto\\.wt\\issue-42',
          branch: 'issue-42',
          dirty: false,
          commitsTodayCount: 3,
        },
      ],
    },
  },
  understanding: 'worked on the thing',
  pendingItems: ['finish the thing'],
  tomorrowPlan: ['start the next thing'],
  generationError: null,
};

describe('StorageAdapter#readHandoff', () => {
  it('returns null when no capture was made today for this session yet (D-025)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.readHandoff('2026-08-16', SAMPLE_HANDOFF.sessionId)).toBeNull();
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('returns null when the whole ~/.seeya/ directory does not exist yet', async () => {
    const parent = await makeTmpDir();
    try {
      const seeyaHome = path.join(parent, 'never-created');
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.readHandoff('2026-08-16', SAMPLE_HANDOFF.sessionId)).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('round-trips a full handoff exactly, including nested git facts and Date fields', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveHandoff('2026-08-16', SAMPLE_HANDOFF);
      const readBack = await storage.readHandoff('2026-08-16', SAMPLE_HANDOFF.sessionId);
      expect(readBack).toEqual(SAMPLE_HANDOFF);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('round-trips a handoff with no git repository at all (facts.git: null)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const handoff: Handoff = {
        ...SAMPLE_HANDOFF,
        source: 'noTranscript',
        sources: ['registry'],
        facts: { lastActivity: null, lastPrompts: [], touchedFiles: [], git: null },
      };
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveHandoff('2026-08-16', handoff);
      const readBack = await storage.readHandoff('2026-08-16', handoff.sessionId);
      expect(readBack).toEqual(handoff);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('writes to ~/.seeya/days/<day>/sessions/<sessionId>.json (docs/ESPECIFICACAO.md layout)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveHandoff('2026-08-16', SAMPLE_HANDOFF);
      const expectedPath = path.join(
        seeyaHome,
        'days',
        '2026-08-16',
        'sessions',
        `${SAMPLE_HANDOFF.sessionId}.json`,
      );
      const raw = await readFile(expectedPath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      expect(parsed).toMatchObject({ sessionId: SAMPLE_HANDOFF.sessionId, schemaVersion: 1 });
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('two different sessions on the same day do not collide', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      const other: Handoff = {
        ...SAMPLE_HANDOFF,
        sessionId: '22222222-2222-4222-8222-222222222222',
      };
      await storage.saveHandoff('2026-08-16', SAMPLE_HANDOFF);
      await storage.saveHandoff('2026-08-16', other);
      expect(await storage.readHandoff('2026-08-16', SAMPLE_HANDOFF.sessionId)).toEqual(
        SAMPLE_HANDOFF,
      );
      expect(await storage.readHandoff('2026-08-16', other.sessionId)).toEqual(other);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error when the handoff file is not valid JSON — never reads as "not captured"', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dir = path.join(seeyaHome, 'days', '2026-08-16', 'sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${SAMPLE_HANDOFF.sessionId}.json`), '{not json', 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readHandoff('2026-08-16', SAMPLE_HANDOFF.sessionId)).rejects.toThrow(
        /not valid JSON/,
      );
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws a visible error when a required field is malformed', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dir = path.join(seeyaHome, 'days', '2026-08-16', 'sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, `${SAMPLE_HANDOFF.sessionId}.json`),
        JSON.stringify({ schemaVersion: 1, sessionId: 123 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readHandoff('2026-08-16', SAMPLE_HANDOFF.sessionId)).rejects.toThrow(
        /malformed/,
      );
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('throws instead of silently accepting a schemaVersion newer than this build knows how to read', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dir = path.join(seeyaHome, 'days', '2026-08-16', 'sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, `${SAMPLE_HANDOFF.sessionId}.json`),
        JSON.stringify({ schemaVersion: 999 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      await expect(storage.readHandoff('2026-08-16', SAMPLE_HANDOFF.sessionId)).rejects.toThrow(
        /schemaVersion/,
      );
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});
