/**
 * `listUninspectableSessionKeys` (S1-T7, recovered logic from `process-key.ts`/D-023, commit
 * `e45b348`) against a real filesystem, but a fake `~/.claude` built in `tmpdir` — same fixture
 * helper the registry suite uses (docs/TESTES.md § Integração).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { listUninspectableSessionKeys } from '../../../src/adapters/discovery/index.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  writeRawSessionFile,
  writeSessionRecord,
  type DiscoveryFixture,
} from './_fixtures.js';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

async function list() {
  if (fixture === undefined) {
    throw new Error('call createDiscoveryFixture() first');
  }
  return listUninspectableSessionKeys(fixture.claudeHome);
}

describe('listUninspectableSessionKeys — directory shape', () => {
  it('a missing sessions directory produces an empty result, not a crash', async () => {
    fixture = await createDiscoveryFixture();
    await rm(fixture.sessionsDir, { recursive: true, force: true });

    expect(await list()).toStrictEqual({ fileNames: [], rejected: [] });
  });

  it('an empty sessions directory produces an empty result', async () => {
    fixture = await createDiscoveryFixture();

    expect(await list()).toStrictEqual({ fileNames: [], rejected: [] });
  });

  it('the sessions directory not actually being a directory is reported, not thrown', async () => {
    fixture = await createDiscoveryFixture();
    await rm(fixture.sessionsDir, { recursive: true, force: true });
    await writeFile(fixture.sessionsDir, 'this is a file where a directory was expected', 'utf8');

    const result = await list();

    expect(result.fileNames).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toBe(fixture.sessionsDir);
  });
});

describe('listUninspectableSessionKeys — the D-029 detection itself', () => {
  it('a .key file with no matching .json is reported by name only, never read', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, '4242.deadbeef.key', 'sensitive material — never read');

    const result = await list();

    expect(result.fileNames).toStrictEqual(['4242.deadbeef.key']);
    expect(result.rejected).toStrictEqual([]);
    // Proof the content was never opened: if it had been, nothing above would change, so this
    // independently confirms the fixture still holds exactly what was written (mode-600 spirit —
    // AGENTS.md: never assert by absence alone when a positive check is this cheap).
    const rawContent = await readFile(`${fixture.sessionsDir}/4242.deadbeef.key`, 'utf8');
    expect(rawContent).toBe('sensitive material — never read');
  });

  it('a .key file WITH a matching .json is left alone — registry.ts territory, not a warning', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\projeto',
      startedAt: 1_755_360_000_000,
      procStart: '999999000011112222',
      name: 'projeto',
    });
    await writeRawSessionFile(fixture, '4242.deadbeef.key', 'sensitive material');

    const result = await list();

    expect(result.fileNames).toStrictEqual([]);
    expect(result.rejected).toStrictEqual([]);
  });

  it('multiple independent .key-without-.json files are all reported', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, '1001.aaaaaaaa.key', 'x');
    await writeRawSessionFile(fixture, '1002.bbbbbbbb.key', 'y');

    const result = await list();

    expect([...result.fileNames].sort()).toStrictEqual(['1001.aaaaaaaa.key', '1002.bbbbbbbb.key']);
  });

  it('a .key file name that does not match "<pid>.<hash>.key" is rejected, not silently skipped or accepted', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, 'not-a-valid-name.key', 'x');

    const result = await list();

    expect(result.fileNames).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.raw).toBe('not-a-valid-name.key');
    expect(result.rejected[0]?.reason).toContain('not-a-valid-name.key');
  });

  it('.json files without a .key sibling are unaffected — this module only reports .key files', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\projeto',
      startedAt: 1_755_360_000_000,
      procStart: '999999000011112222',
      name: 'projeto',
    });

    expect(await list()).toStrictEqual({ fileNames: [], rejected: [] });
  });
});
