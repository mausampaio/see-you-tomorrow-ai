/**
 * `registerFork` against a real `tmpdir` (D-012, Q-008's format). `deep-generator.test.ts`
 * already proves this is called at the right time relative to a real `claude` spawn; this file
 * covers the read-merge-write logic itself in isolation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerFork } from '../../../src/adapters/generation/fork-registration.js';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-16T21:00:00.000Z');

let seeyaHome: string;

beforeEach(async () => {
  seeyaHome = await mkdtemp(path.join(tmpdir(), 'seeya-fork-registration-'));
});

afterEach(async () => {
  await rm(seeyaHome, { recursive: true, force: true });
});

async function readRegistry(): Promise<{ schemaVersion: number; forks: unknown[] }> {
  const text = await readFile(path.join(seeyaHome, 'forks.json'), 'utf8');
  return JSON.parse(text) as { schemaVersion: number; forks: unknown[] };
}

describe('registerFork', () => {
  it('creates forks.json from nothing, in the Q-008 shape', async () => {
    const result = await registerFork(seeyaHome, SESSION_A, NOW);

    expect(result.rejected).toStrictEqual([]);
    const registry = await readRegistry();
    expect(registry).toStrictEqual({
      schemaVersion: 1,
      forks: [{ sessionId: SESSION_A, createdAt: NOW.toISOString() }],
    });
  });

  it('appends to an existing valid registry, preserving the earlier entry and its createdAt', async () => {
    await registerFork(seeyaHome, SESSION_A, new Date('2026-08-01T00:00:00.000Z'));

    await registerFork(seeyaHome, SESSION_B, NOW);

    const registry = await readRegistry();
    expect(registry.forks).toStrictEqual([
      { sessionId: SESSION_A, createdAt: '2026-08-01T00:00:00.000Z' },
      { sessionId: SESSION_B, createdAt: NOW.toISOString() },
    ]);
  });

  it('registering the same sessionId twice does not duplicate the entry', async () => {
    await registerFork(seeyaHome, SESSION_A, NOW);

    await registerFork(seeyaHome, SESSION_A, NOW);

    const registry = await readRegistry();
    expect(registry.forks).toHaveLength(1);
  });

  it('a corrupted existing forks.json still gets a fresh, valid file with the new fork registered', async () => {
    await writeFile(path.join(seeyaHome, 'forks.json'), 'not json {{{', 'utf8');

    const result = await registerFork(seeyaHome, SESSION_A, NOW);

    expect(result.rejected).toHaveLength(1);
    const registry = await readRegistry();
    expect(registry.forks).toStrictEqual([{ sessionId: SESSION_A, createdAt: NOW.toISOString() }]);
  });

  it('writes atomically — no .tmp file left behind after a successful write', async () => {
    await registerFork(seeyaHome, SESSION_A, NOW);

    const files = await readdir(seeyaHome);
    expect(files).toStrictEqual(['forks.json']);
  });
});
