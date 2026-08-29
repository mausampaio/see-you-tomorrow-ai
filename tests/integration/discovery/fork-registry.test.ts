/**
 * Direct tests of `adapters/discovery/fork-registry.ts`'s own exports — the whole-file/root-shape
 * and per-item validation paths are already exercised thoroughly through
 * `registry.test.ts`'s "fork exclusion (D-012)" describe block (which calls `readForkRegistry`,
 * the identity-only view built on top of this module). This file adds what that one doesn't need:
 * `readForkRegistryEntries` keeping each entry's full shape (`createdAt` included) — the property
 * `adapters/generation/fork-registration.ts` (S2-T2) depends on to merge a new fork in without
 * losing every other fork's recorded age.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  readForkRegistryEntries,
  forkRegistryPath,
} from '../../../src/adapters/discovery/fork-registry.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  writeForksJson,
  type DiscoveryFixture,
} from './_fixtures.js';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

let fixture: DiscoveryFixture;

beforeEach(async () => {
  fixture = await createDiscoveryFixture();
});

afterEach(async () => {
  await removeDiscoveryFixture(fixture);
});

describe('readForkRegistryEntries', () => {
  it('an absent forks.json reads as zero entries, not an error (D-025)', async () => {
    const result = await readForkRegistryEntries(fixture.seeyaHome);
    expect(result).toStrictEqual({ entries: [], rejected: [] });
  });

  it('preserves createdAt on each entry, unlike readForkRegistry which only keeps identity', async () => {
    await writeForksJson(fixture, [
      { sessionId: SESSION_A, createdAt: '2026-08-16T21:00:00.000Z' },
      { sessionId: SESSION_B, createdAt: '2026-08-01T00:00:00.000Z' },
    ]);

    const result = await readForkRegistryEntries(fixture.seeyaHome);

    expect(result.entries).toStrictEqual([
      { sessionId: SESSION_A, createdAt: '2026-08-16T21:00:00.000Z' },
      { sessionId: SESSION_B, createdAt: '2026-08-01T00:00:00.000Z' },
    ]);
    expect(result.rejected).toStrictEqual([]);
  });

  it('an entry missing createdAt is still accepted, with createdAt undefined (D-021 tolerance)', async () => {
    await writeForksJson(fixture, [{ sessionId: SESSION_A }]);

    const result = await readForkRegistryEntries(fixture.seeyaHome);

    expect(result.entries).toStrictEqual([{ sessionId: SESSION_A }]);
  });
});

describe('forkRegistryPath', () => {
  it('joins seeyaHome and forks.json with node:path (AGENTS.md: never a literal separator)', () => {
    expect(forkRegistryPath(fixture.seeyaHome)).toBe(path.join(fixture.seeyaHome, 'forks.json'));
  });
});
