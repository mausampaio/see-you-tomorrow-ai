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
    assistantMessages: [],
    touchedFiles: ['src/a.ts'],
    git: [
      {
        root: 'c:\\code\\projeto',
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
    ],
    filesOutsideRepository: 0,
    reposNotVisited: 0,
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

  it('round-trips a handoff with no git repository at all (D-032: facts.git: [])', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const handoff: Handoff = {
        ...SAMPLE_HANDOFF,
        source: 'noTranscript',
        sources: ['registry'],
        facts: {
          lastActivity: null,
          lastPrompts: [],
          assistantMessages: [],
          touchedFiles: [],
          git: [],
          filesOutsideRepository: 0,
          reposNotVisited: 0,
        },
      };
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveHandoff('2026-08-16', handoff);
      const readBack = await storage.readHandoff('2026-08-16', handoff.sessionId);
      expect(readBack).toEqual(handoff);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  // S4-T00c/Q-036: assistantMessages feeds the lean prompt but is not a disk key (a maintainer
  // decision, not an oversight — see core/types.ts#SessionFacts.assistantMessages's docstring and
  // adapters/storage/handoff-schema.ts#parseHandoffFacts). This is the regression test for that
  // exclusion: saving a handoff whose facts DO carry assistant text must read back empty, not
  // reconstruct or persist it.
  it('never persists facts.assistantMessages, even when present when saving (Q-036)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const handoff: Handoff = {
        ...SAMPLE_HANDOFF,
        facts: { ...SAMPLE_HANDOFF.facts, assistantMessages: ['4 done, 6 pending'] },
      };
      const storage = new StorageAdapter(seeyaHome);
      await storage.saveHandoff('2026-08-16', handoff);
      const raw = await readFile(
        path.join(seeyaHome, 'days', '2026-08-16', 'sessions', `${handoff.sessionId}.json`),
        'utf8',
      );
      expect(raw).not.toContain('4 done, 6 pending');
      const readBack = await storage.readHandoff('2026-08-16', handoff.sessionId);
      expect(readBack?.facts.assistantMessages).toEqual([]);
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
      expect(parsed).toMatchObject({ sessionId: SAMPLE_HANDOFF.sessionId, schemaVersion: 2 });
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

/**
 * D-032's mandatory migration (docs/PLANO-DE-ENTREGA.md S4-T0): "handoff versão 1, com `git`
 * singular, tem que ser lido como lista de um elemento" — this is the aceite test that protects the
 * maintainer's own real days already on disk (30/08 a 02/09) from `HANDOFF_SCHEMA_VERSION`'s bump
 * to 2. Every document here is written as PLAIN JSON, deliberately never through
 * `serializeHandoff` (which only ever writes the CURRENT version) — this is what a real file
 * written before this task existed actually looks like on somebody's disk.
 */
describe('StorageAdapter#readHandoff — D-032 migration from schemaVersion 1', () => {
  function writeV1Document(seeyaHome: string, day: string, document: Record<string, unknown>) {
    const dir = path.join(seeyaHome, 'days', day, 'sessions');
    return mkdir(dir, { recursive: true }).then(() =>
      writeFile(path.join(dir, `${document.sessionId as string}.json`), JSON.stringify(document)),
    );
  }

  const V1_DOCUMENT = {
    schemaVersion: 1,
    sessionId: '33333333-3333-4333-8333-333333333333',
    cwd: 'c:\\code\\projeto-antigo',
    name: 'projeto-antigo-01',
    capturedAt: '2026-08-30T21:00:00.000Z',
    sessionState: 'ended',
    capturedDuringActiveTurn: false,
    source: 'model',
    captureMode: 'lean',
    sources: ['git', 'transcript', 'registry'],
    facts: {
      lastActivity: '2026-08-30T20:45:00.000Z',
      lastPrompts: ['fix the bug'],
      touchedFiles: ['src/a.ts'],
      git: {
        branch: 'main',
        dirty: true,
        modifiedFiles: ['src/a.ts'],
        commitsToday: [{ sha: '1b7fd99', title: 'fix: bug' }],
        worktrees: [],
      },
    },
    understanding: 'worked on the old thing',
    pendingItems: [],
    tomorrowPlan: [],
    generationError: null,
  };

  it('a v1 handoff with a singular facts.git is read without error, as a one-element list', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeV1Document(seeyaHome, '2026-08-30', V1_DOCUMENT);
      const storage = new StorageAdapter(seeyaHome);
      const handoff = await storage.readHandoff('2026-08-30', V1_DOCUMENT.sessionId);
      expect(handoff).not.toBeNull();
      expect(handoff!.facts.git).toEqual([{ root: V1_DOCUMENT.cwd, ...V1_DOCUMENT.facts.git }]);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it("a v1 handoff's filesOutsideRepository/reposNotVisited come back null — never 0 (D-025)", async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeV1Document(seeyaHome, '2026-08-30', V1_DOCUMENT);
      const storage = new StorageAdapter(seeyaHome);
      const handoff = await storage.readHandoff('2026-08-30', V1_DOCUMENT.sessionId);
      expect(handoff!.facts.filesOutsideRepository).toBeNull();
      expect(handoff!.facts.reposNotVisited).toBeNull();
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('a v1 handoff with facts.git: null migrates to an empty list, not an error', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      const document = { ...V1_DOCUMENT, facts: { ...V1_DOCUMENT.facts, git: null } };
      await writeV1Document(seeyaHome, '2026-08-30', document);
      const storage = new StorageAdapter(seeyaHome);
      const handoff = await storage.readHandoff('2026-08-30', document.sessionId);
      expect(handoff!.facts.git).toEqual([]);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('listHandoffs (the whole-day briefing read) also migrates a v1 file transparently', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeV1Document(seeyaHome, '2026-08-30', V1_DOCUMENT);
      const storage = new StorageAdapter(seeyaHome);
      const { handoffs, rejected } = await storage.listHandoffs('2026-08-30');
      expect(rejected).toEqual([]);
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0]!.facts.git).toEqual([{ root: V1_DOCUMENT.cwd, ...V1_DOCUMENT.facts.git }]);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });

  it('reading the same v1 file twice produces the identical result both times (no write-on-read)', async () => {
    const seeyaHome = await makeTmpDir();
    try {
      await writeV1Document(seeyaHome, '2026-08-30', V1_DOCUMENT);
      const storage = new StorageAdapter(seeyaHome);
      const first = await storage.readHandoff('2026-08-30', V1_DOCUMENT.sessionId);
      const rawBetweenReads = await readFile(
        path.join(seeyaHome, 'days', '2026-08-30', 'sessions', `${V1_DOCUMENT.sessionId}.json`),
        'utf8',
      );
      const second = await storage.readHandoff('2026-08-30', V1_DOCUMENT.sessionId);
      // The migration happens in memory only (`resolveSchemaVersion` never writes back) — a
      // `--dry-run` or a second `seeya start-day` reading the same day must never depend on the
      // first read having "upgraded the file on disk" as a side effect.
      expect(JSON.parse(rawBetweenReads)).toMatchObject({ schemaVersion: 1 });
      expect(second).toEqual(first);
    } finally {
      await rm(seeyaHome, { recursive: true, force: true });
    }
  });
});
