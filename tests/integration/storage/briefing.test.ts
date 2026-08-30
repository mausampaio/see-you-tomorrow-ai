/**
 * `StorageAdapter#listHandoffs`/`#saveBriefing` against a real `tmpdir` (docs/TESTES.md §
 * "Integração"), same style as `handoff.test.ts`. `listHandoffs` is D-022's per-item validation
 * applied to a whole day's `sessions/` directory (S2-T4): the mandatory test here is one corrupted
 * file among good ones, proving the batch survives it.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import type { Handoff } from '../../../src/core/types.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-briefing-'));
}

function sampleHandoff(sessionId: string, name: string): Handoff {
  return {
    sessionId,
    cwd: `c:\\code\\${name}`,
    name,
    capturedAt: new Date('2026-08-16T21:00:00.000Z'),
    sessionState: 'ended',
    capturedDuringActiveTurn: false,
    source: 'model',
    captureMode: 'lean',
    sources: ['git', 'transcript', 'registry'],
    facts: { lastActivity: null, lastPrompts: [], touchedFiles: [], git: null },
    understanding: `worked on ${name}`,
    pendingItems: [],
    tomorrowPlan: [],
    generationError: null,
  };
}

describe('StorageAdapter#listHandoffs', () => {
  it('returns empty when no day directory exists yet (D-025)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.listHandoffs('2026-08-16')).toEqual({ handoffs: [], rejected: [] });
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('returns every handoff saved for the day', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      const a = sampleHandoff('11111111-1111-4111-8111-111111111111', 'projeto-a');
      const b = sampleHandoff('22222222-2222-4222-8222-222222222222', 'projeto-b');
      await storage.saveHandoff('2026-08-16', a);
      await storage.saveHandoff('2026-08-16', b);
      const { handoffs, rejected } = await storage.listHandoffs('2026-08-16');
      expect(rejected).toEqual([]);
      expect(handoffs.map((h) => h.sessionId).sort()).toEqual([a.sessionId, b.sessionId].sort());
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it(
    'a corrupted handoff file is reported in rejected, without dropping the readable ones ' +
      '(D-022, aceite #4)',
    async () => {
      const seeyaHome = await makeTmpDir();
      try {
        const storage = new StorageAdapter(seeyaHome);
        const good = sampleHandoff('11111111-1111-4111-8111-111111111111', 'projeto-a');
        await storage.saveHandoff('2026-08-16', good);
        const dir = path.join(seeyaHome, 'days', '2026-08-16', 'sessions');
        await writeFile(path.join(dir, 'broken.json'), '{not json', 'utf8');

        const { handoffs, rejected } = await storage.listHandoffs('2026-08-16');
        expect(handoffs).toEqual([good]);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.file).toContain('broken.json');
        expect(rejected[0]?.reason).toMatch(/not valid JSON/);
      } finally {
        await rm(seeyaHome, { recursive: true, force: true });
      }
    },
  );

  it('a handoff with an unsupported schemaVersion is rejected, not silently skipped', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dir = path.join(seeyaHome, 'days', '2026-08-16', 'sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'future.json'),
        JSON.stringify({ schemaVersion: 999 }),
        'utf8',
      );
      const storage = new StorageAdapter(seeyaHome);
      const { handoffs, rejected } = await storage.listHandoffs('2026-08-16');
      expect(handoffs).toEqual([]);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatch(/schemaVersion/);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('ignores non-JSON files sitting in the same directory', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const dir = path.join(seeyaHome, 'days', '2026-08-16', 'sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'notes.txt'), 'not a handoff', 'utf8');
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.listHandoffs('2026-08-16')).toEqual({ handoffs: [], rejected: [] });
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});

describe('StorageAdapter#saveBriefing', () => {
  it('writes to ~/.seeya/days/<day>/summary.md, next to sessions/ (docs/ESPECIFICACAO.md layout)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveBriefing('2026-08-16', '# Daily briefing — 2026-08-16\n');
      const expectedPath = path.join(seeyaHome, 'days', '2026-08-16', 'summary.md');
      expect(await readFile(expectedPath, 'utf8')).toBe('# Daily briefing — 2026-08-16\n');
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('creates the day directory on first write, same as saveHandoff', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveBriefing('2026-08-16', 'content');
      const expectedPath = path.join(seeyaHome, 'days', '2026-08-16', 'summary.md');
      await expect(readFile(expectedPath, 'utf8')).resolves.toBe('content');
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('overwrites a previous briefing for the same day (regeneration on a later --session run)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveBriefing('2026-08-16', 'first version');
      await storage.saveBriefing('2026-08-16', 'second version');
      const expectedPath = path.join(seeyaHome, 'days', '2026-08-16', 'summary.md');
      expect(await readFile(expectedPath, 'utf8')).toBe('second version');
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});

describe('StorageAdapter#readBriefing (S3-T1)', () => {
  it('returns null when nothing was ever captured for the day (D-025: absence, not error)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      expect(await storage.readBriefing('2026-08-16')).toBeNull();
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('returns the day attached alongside every handoff saved for it — no second read path', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      const a = sampleHandoff('11111111-1111-4111-8111-111111111111', 'projeto-a');
      const b = sampleHandoff('22222222-2222-4222-8222-222222222222', 'projeto-b');
      await storage.saveHandoff('2026-08-16', a);
      await storage.saveHandoff('2026-08-16', b);

      const briefing = await storage.readBriefing('2026-08-16');
      expect(briefing).not.toBeNull();
      expect(briefing?.day).toBe('2026-08-16');
      expect(briefing?.rejected).toEqual([]);
      expect(briefing?.handoffs.map((h) => h.sessionId).sort()).toEqual(
        [a.sessionId, b.sessionId].sort(),
      );
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it(
    'a day where every handoff on file is unreadable is NOT null — D-022: unreadable is not ' +
      'the same as never captured',
    async () => {
      const seeyaHome = await makeTmpDir();
      try {
        const dir = path.join(seeyaHome, 'days', '2026-08-16', 'sessions');
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, 'broken.json'), '{not json', 'utf8');
        const storage = new StorageAdapter(seeyaHome);

        const briefing = await storage.readBriefing('2026-08-16');
        expect(briefing).not.toBeNull();
        expect(briefing?.handoffs).toEqual([]);
        expect(briefing?.rejected).toHaveLength(1);
        expect(briefing?.rejected[0]?.file).toContain('broken.json');
      } finally {
        await rm(seeyaHome, { recursive: true, force: true });
      }
    },
  );

  it('reads a different day than the one just written, independently (day-keyed, D-027)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveHandoff(
        '2026-08-15',
        sampleHandoff('11111111-1111-4111-8111-111111111111', 'projeto-a'),
      );
      expect(await storage.readBriefing('2026-08-16')).toBeNull();
      expect(await storage.readBriefing('2026-08-15')).not.toBeNull();
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});
