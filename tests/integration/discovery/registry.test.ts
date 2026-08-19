/**
 * `discoverSessionsFromRegistry` against a real filesystem, but a fake `~/.claude` + `~/.seeya`
 * built in `tmpdir` (docs/TESTES.md § Integração: "um `~/.claude` falso montado em `tmpdir`, com
 * registros válidos, registros obsoletos, JSON corrompido e campo faltando. Verificar que
 * corrompido é ignorado com log, não crash.").
 *
 * `ProcessControl` is faked (`FakeProcessControl`) rather than exercised for real: real PID
 * liveness is `adapters/process`'s own suite (tests/integration/process/) — this suite is about
 * the registry strategy's own file/JSON handling and field mapping.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverSessionsFromRegistry } from '../../../src/adapters/discovery/index.js';
import { FakeProcessControl } from './_fake-process-control.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  writeForksJson,
  writeRawSessionFile,
  writeSessionRecord,
  writeTranscript,
  type DiscoveryFixture,
} from './_fixtures.js';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';
const SESSION_C = '33333333-3333-4333-8333-333333333333';

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pid: 4242,
    sessionId: SESSION_A,
    cwd: 'c:\\code\\projeto-01',
    startedAt: 1_755_360_000_000,
    procStart: '999999000011112222',
    name: 'projeto-01',
    ...overrides,
  };
}

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

async function discover(processControl = new FakeProcessControl()) {
  if (fixture === undefined) {
    throw new Error('call createDiscoveryFixture() first');
  }
  return discoverSessionsFromRegistry({
    claudeHome: fixture.claudeHome,
    seeyaHome: fixture.seeyaHome,
    processControl,
  });
}

describe('discoverSessionsFromRegistry — directory shape', () => {
  it('a missing sessions directory produces an empty result, not a crash', async () => {
    fixture = await createDiscoveryFixture();
    // Fixture creates sessionsDir empty, not missing — remove it to test the "never created" case.
    await rm(fixture.sessionsDir, { recursive: true, force: true });

    const result = await discover();

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('an empty sessions directory produces an empty result', async () => {
    fixture = await createDiscoveryFixture();

    const result = await discover();

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });
});

describe('discoverSessionsFromRegistry — valid records', () => {
  it('accepts a valid record and reports it alive, with the recorded name', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());

    const result = await discover();

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      hasPid: true,
      sessionId: SESSION_A,
      cwd: 'c:\\code\\projeto-01',
      name: 'projeto-01',
      pid: 4242,
      processIsAlive: true,
      hasTranscript: false,
      lastTranscriptWrite: null,
    });
  });

  it('derives the name from cwd when the record has none (D-021)', async () => {
    fixture = await createDiscoveryFixture();
    const record = validRecord();
    delete record['name'];
    await writeSessionRecord(fixture, '4242', record);

    const result = await discover();

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions[0]?.name).toBe('projeto-01');
  });

  it('finds the transcript by scanning every project slug for <sessionId>.jsonl and uses its mtime', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await writeTranscript(fixture, 'c--code-projeto-01', SESSION_A);

    const result = await discover();

    expect(result.sessions[0]?.hasTranscript).toBe(true);
    expect(result.sessions[0]?.lastTranscriptWrite).toBeInstanceOf(Date);
    expect(result.sessions[0]?.lastActivity).toStrictEqual(result.sessions[0]?.lastTranscriptWrite);
  });

  it('accepts multiple independent valid records', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await writeSessionRecord(
      fixture,
      '9999',
      validRecord({ pid: 9999, sessionId: SESSION_B, name: 'projeto-02' }),
    );

    const result = await discover();

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.map((s) => s.sessionId).sort()).toStrictEqual(
      [SESSION_A, SESSION_B].sort(),
    );
  });

  /**
   * Q-006 regression, exercised end-to-end through the whole adapter (not just the schema unit
   * test in tests/unit/adapters/discovery/schemas.test.ts): before the fix, `sessionRecordSchema`
   * rejected this record outright, and the session would never have reached `sessions` — it
   * would have shown up only as a silent gap, not even a rejection, on macOS.
   */
  it('accepts a record with a macOS-shaped procStart (Q-006 regression)', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(
      fixture,
      '4242',
      validRecord({ procStart: 'Mon Aug 17 14:23:01 2026' }),
    );

    const result = await discover();

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.procStart).toBe('Mon Aug 17 14:23:01 2026');
  });
});

describe('discoverSessionsFromRegistry — stale (obsolete) records, D-016', () => {
  /**
   * docs/ESPECIFICACAO.md § "Como as sessões são descobertas": "entradas obsoletas são
   * reportadas como sessões encerradas, não descartadas: elas ainda têm transcript e ainda
   * merecem handoff." Confirmed by docs/spikes/E-registro-efemero-e-sessao-concluida.md: the
   * registry entry is deleted on a graceful exit, so a stale entry (a dead PID) only survives an
   * abnormal one (crash, power loss) — it's an accident, never a confirmed-finished session, and
   * treating it as "done, ignore it" would hide exactly the sessions most likely to have unsaved
   * work. This adapter's job is only to carry `processIsAlive: false` through, unfiltered;
   * `core/classification.ts#classifyState` is what turns that into the `ended` state.
   */
  it('a record whose PID is no longer alive still enters the list, marked not-alive', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());

    const result = await discover(new FakeProcessControl(new Map([[4242, false]])));

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ hasPid: true, processIsAlive: false });
  });
});

describe('discoverSessionsFromRegistry — corrupted and incomplete files (D-022)', () => {
  it('a syntactically broken JSON file is rejected with a reason, not thrown', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, 'broken.json', '{ this is not json');

    const result = await discover();

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toEqual(expect.any(String));
    expect(result.rejected[0]?.reason.length).toBeGreaterThan(0);
  });

  it('valid JSON missing a required field (sessionId) is rejected, not thrown', async () => {
    fixture = await createDiscoveryFixture();
    const record = validRecord();
    delete record['sessionId'];
    await writeSessionRecord(fixture, '4242', record);

    const result = await discover();

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toEqual(expect.any(String));
  });

  /**
   * Aceite item 4: a corrupted file in the middle of the directory must not stop the others from
   * being discovered, and the rejection must be countable — not a silent gap. Three files, one
   * bad one in between, alphabetically sorted so it really sits "in the middle" of the listing.
   */
  it('a corrupted file in the middle of the directory does not block the others; the rejection is countable', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'a-first', validRecord({ pid: 1001, sessionId: SESSION_A }));
    await writeRawSessionFile(fixture, 'b-corrupted.json', 'not json at all {{{');
    await writeSessionRecord(
      fixture,
      'c-last',
      validRecord({
        pid: 1002,
        sessionId: SESSION_B,
        cwd: 'c:\\code\\projeto-02',
        name: 'projeto-02',
      }),
    );

    const result = await discover();

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.map((s) => s.sessionId).sort()).toStrictEqual(
      [SESSION_A, SESSION_B].sort(),
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toMatch(/b-corrupted\.json$/);
  });

  it('a .key file with no matching .json is left alone — never read, never reported (D-023 territory)', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'a-json', validRecord());
    await writeRawSessionFile(
      fixture,
      '9999.deadbeef.key',
      'sensitive material — must not be read',
    );

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.rejected).toStrictEqual([]);
  });
});

describe('discoverSessionsFromRegistry — fork exclusion (D-012)', () => {
  it('a sessionId listed in forks.json is excluded — not in sessions, not in rejected', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'a-fork', validRecord({ pid: 1001, sessionId: SESSION_A }));
    await writeSessionRecord(
      fixture,
      'b-normal',
      validRecord({
        pid: 1002,
        sessionId: SESSION_B,
        cwd: 'c:\\code\\projeto-02',
        name: 'projeto-02',
      }),
    );
    await writeForksJson(fixture, [{ sessionId: SESSION_A }]);

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe(SESSION_B);
    expect(result.rejected).toStrictEqual([]);
  });

  it('an absent forks.json excludes nothing (no forks registered yet is the normal case)', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'a-normal', validRecord());

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
  });

  it('a corrupted forks.json is surfaced as a rejection but does not block real sessions from being discovered', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'a-normal', validRecord());
    await writeFile(path.join(fixture.seeyaHome, 'forks.json'), 'not json {{{', 'utf8');

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toMatch(/forks\.json$/);
  });

  it('an unknown sessionId (id 3, not in forks.json) is unaffected by an unrelated fork entry', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'c', validRecord({ pid: 1003, sessionId: SESSION_C }));
    await writeForksJson(fixture, [{ sessionId: SESSION_A }]);

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe(SESSION_C);
  });

  it('an unreadable forks.json (a directory, not a file) is surfaced as a rejection, not thrown', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'a-normal', validRecord());
    await mkdir(path.join(fixture.seeyaHome, 'forks.json'));

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toMatch(/forks\.json$/);
  });

  it('a forks.json that parses but is not a JSON array is rejected as a whole file', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'a-normal', validRecord());
    await writeForksJson(fixture, { sessionId: SESSION_A }); // object, not array

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('must be a JSON array');
  });

  it('a fork entry without a valid sessionId is rejected item-by-item, the rest of the array still applies (D-022)', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'a-fork', validRecord({ pid: 1001, sessionId: SESSION_A }));
    await writeSessionRecord(
      fixture,
      'b-normal',
      validRecord({
        pid: 1002,
        sessionId: SESSION_B,
        cwd: 'c:\\code\\projeto-02',
        name: 'projeto-02',
      }),
    );
    await writeForksJson(fixture, [{ sessionId: SESSION_A }, { nope: 'not a sessionId at all' }]);

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe(SESSION_B);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toMatch(/forks\.json$/);
  });
});

describe('discoverSessionsFromRegistry — transcript lookup across multiple project slugs', () => {
  it('finds the transcript in the second slug when the first one does not have it', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await writeTranscript(fixture, 'some-other-project', SESSION_B);
    await writeTranscript(fixture, 'projeto-01-slug', SESSION_A);

    const result = await discover();

    expect(result.sessions[0]?.hasTranscript).toBe(true);
  });

  it('reports no transcript when other slugs exist but none has this sessionId', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await writeTranscript(fixture, 'some-other-project', SESSION_B);

    const result = await discover();

    expect(result.sessions[0]?.hasTranscript).toBe(false);
    expect(result.sessions[0]?.lastTranscriptWrite).toBeNull();
  });

  it('reports no transcript when ~/.claude/projects has never been created at all (ENOENT, not an error)', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await rm(fixture.projectsDir, { recursive: true, force: true });

    const result = await discover();

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions[0]?.hasTranscript).toBe(false);
    expect(result.sessions[0]?.lastTranscriptWrite).toBeNull();
  });
});

describe('discoverSessionsFromRegistry — directory- and record-level failures are isolated, never thrown', () => {
  /**
   * `sessions/` existing but not actually being a directory is worse than "not created yet"
   * (ENOENT) — it's the case `listSessionJsonFilesOrRejection` exists for: reported as one
   * rejection instead of throwing out of `discoverSessionsFromRegistry` and losing the whole
   * result.
   */
  it('the sessions directory not actually being a directory is reported, not thrown', async () => {
    fixture = await createDiscoveryFixture();
    await rm(fixture.sessionsDir, { recursive: true, force: true });
    await writeFile(fixture.sessionsDir, 'this is a file where a directory was expected', 'utf8');

    const result = await discover();

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toBe(fixture.sessionsDir);
    expect(result.rejected[0]?.reason).toEqual(expect.any(String));
  });

  it('a session file that is actually a directory is rejected (readFile failure), not thrown', async () => {
    fixture = await createDiscoveryFixture();
    await mkdir(path.join(fixture.sessionsDir, 'not-a-file.json'));

    const result = await discover();

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toEqual(expect.any(String));
  });

  /**
   * `~/.claude/projects` not actually being a directory makes `findTranscript`'s `readdir` throw
   * something other than `ENOENT` (docs D-025: reporting `hasTranscript: false` there would be an
   * unearned claim). `processSessionFile`'s own `catch` is what turns that into a per-record
   * rejection instead of crashing `discoverSessionsFromRegistry`'s whole `Promise.all` — this is
   * the regression test for that guarantee (registry.ts's top-of-file promise).
   */
  it('an unexpected failure resolving one record (transcript lookup) rejects only that record', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await rm(fixture.projectsDir, { recursive: true, force: true });
    await writeFile(fixture.projectsDir, 'this is a file where a directory was expected', 'utf8');

    const result = await discover();

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toBe(path.join(fixture.sessionsDir, '4242.json'));
    expect(result.rejected[0]?.reason).toContain('discovery failed');
  });
});
