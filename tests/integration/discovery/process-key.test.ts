/**
 * `discoverSessionsFromProcessKey` against a real filesystem, but a fake `~/.claude` built in
 * `tmpdir` (docs/TESTES.md § Integração). `ProcessControl` is faked (`FakeProcessControl`) for
 * every case except the dedicated "real process" describe block at the bottom, which is what
 * proves docs/PLANO-DE-ENTREGA.md S1-T10's aceite item 1: a session launched by script with a
 * prompt as its argument is discovered, with real `cwd` and command line, against a real spawned
 * process — not just a double standing in for one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSessionsFromProcessKey } from '../../../src/adapters/discovery/index.js';
import { processControl as realProcessControl } from '../../../src/adapters/process/index.js';
import { FakeProcessControl } from './_fake-process-control.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  writeRawSessionFile,
  writeSessionRecord,
  type DiscoveryFixture,
} from './_fixtures.js';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const CHILD_SCRIPT = fileURLToPath(
  new URL('../../fixtures/process/graceful-child.mjs', import.meta.url),
);

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

async function discover(processControl: FakeProcessControl) {
  if (fixture === undefined) {
    throw new Error('call createDiscoveryFixture() first');
  }
  return discoverSessionsFromProcessKey({
    claudeHome: fixture.claudeHome,
    processControl,
    now: NOW,
  });
}

describe('discoverSessionsFromProcessKey — directory shape', () => {
  it('a missing sessions directory produces an empty result, not a crash', async () => {
    fixture = await createDiscoveryFixture();
    await rm(fixture.sessionsDir, { recursive: true, force: true });

    const result = await discover(new FakeProcessControl());

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('an empty sessions directory produces an empty result', async () => {
    fixture = await createDiscoveryFixture();

    const result = await discover(new FakeProcessControl());

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('a sessions directory that is actually a file is reported, not thrown', async () => {
    fixture = await createDiscoveryFixture();
    await rm(fixture.sessionsDir, { recursive: true, force: true });
    await writeFile(fixture.sessionsDir, 'this is a file where a directory was expected', 'utf8');

    const result = await discover(new FakeProcessControl());

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toBe(fixture.sessionsDir);
  });
});

describe('discoverSessionsFromProcessKey — the core shape (D-023)', () => {
  it('a .key with no matching .json is discovered, with cwd/commandLine from ProcessControl', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(
      fixture,
      '4242.deadbeef.key',
      'sensitive material — must not be read',
    );
    const processControl = new FakeProcessControl(
      new Map([[4242, true]]),
      new Map([[4242, 'c:\\code\\autonomous-project']]),
      new Map([[4242, '/agente-interno:dev --item 2990']]),
    );

    const result = await discover(processControl);

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toStrictEqual([
      {
        hasPid: true,
        hasSessionId: false,
        pid: 4242,
        processIsAlive: true,
        cwd: 'c:\\code\\autonomous-project',
        name: 'autonomous-project',
        commandLine: '/agente-interno:dev --item 2990',
        hasTranscript: false,
        lastTranscriptWrite: null,
        lastActivity: NOW,
      },
    ]);
  });

  /** Aceite item 4: proves content is never read, not just that the strategy happens to work
   * without reading it — reusing the same instrument registry.test.ts already established for
   * its own ".key is left alone" case. If this module ever called readFile on the .key, parsing
   * this raw text as anything would either throw (turning this into a rejection) or, worse, leak
   * into a field — neither happens, because the session comes entirely from the file *name* and
   * from ProcessControl. */
  it('never reads the .key file content — the raw text is garbage and the session still builds correctly', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(
      fixture,
      '4242.deadbeef.key',
      'sensitive material — must not be read\x00\x01\x02 not even valid JSON {{{',
    );
    const processControl = new FakeProcessControl(
      new Map([[4242, true]]),
      new Map([[4242, 'c:\\code\\autonomous-project']]),
    );

    const result = await discover(processControl);

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.pid).toBe(4242);
  });

  it('a .key whose pid has a matching <pid>.json is left alone — S1-T3’s territory, not this strategy’s', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', {
      pid: 4242,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\interactive-project',
      startedAt: 1_755_360_000_000,
      procStart: '999999000011112222',
    });
    await writeRawSessionFile(
      fixture,
      '4242.deadbeef.key',
      'sensitive material — must not be read',
    );

    const result = await discover(new FakeProcessControl(new Map([[4242, true]])));

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('a .key whose pid is not alive is ignored — not reported, not rejected (D-023, aceite item 2)', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(
      fixture,
      '4242.deadbeef.key',
      'sensitive material — must not be read',
    );

    const result = await discover(new FakeProcessControl(new Map([[4242, false]])));

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('a .key whose process is alive but cwd could not be read is a visible, countable rejection (D-025/Q-009)', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(
      fixture,
      '4242.deadbeef.key',
      'sensitive material — must not be read',
    );

    const result = await discover(new FakeProcessControl(new Map([[4242, true]])));

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('4242');
    expect(result.rejected[0]?.reason).toContain('cwd');
  });

  it('commandLine null (unreadable) still produces a session — display data, not identity (D-021)', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(
      fixture,
      '4242.deadbeef.key',
      'sensitive material — must not be read',
    );
    const processControl = new FakeProcessControl(
      new Map([[4242, true]]),
      new Map([[4242, 'c:\\code\\autonomous-project']]),
      // no commandLine entry for 4242: FakeProcessControl.readCommandLine defaults to null
    );

    const result = await discover(processControl);

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.commandLine).toBeNull();
  });

  it('a malformed .key name (does not match <pid>.<hash>.key) is a visible rejection, not silently skipped', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, 'not-a-pid.deadbeef.key', 'irrelevant');

    const result = await discover(new FakeProcessControl());

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('does not match');
  });

  it('two .key files naming the same pid produce one session, not two', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, '4242.aaaaaaaa.key', 'irrelevant');
    await writeRawSessionFile(fixture, '4242.bbbbbbbb.key', 'irrelevant');
    const processControl = new FakeProcessControl(
      new Map([[4242, true]]),
      new Map([[4242, 'c:\\code\\autonomous-project']]),
    );

    const result = await discover(processControl);

    expect(result.sessions).toHaveLength(1);
  });

  it('a corrupted-name .key next to a good one does not block the good one from being discovered', async () => {
    fixture = await createDiscoveryFixture();
    await writeRawSessionFile(fixture, 'garbage.key', 'irrelevant');
    await writeRawSessionFile(fixture, '5252.cafebabe.key', 'irrelevant');
    const processControl = new FakeProcessControl(
      new Map([[5252, true]]),
      new Map([[5252, 'c:\\code\\other-project']]),
    );

    const result = await discover(processControl);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.pid).toBe(5252);
    expect(result.rejected).toHaveLength(1);
  });
});

describe('discoverSessionsFromProcessKey — real process (D-023 aceite item 1)', () => {
  let spawned: ChildProcess[] = [];
  let workDir: string | undefined;

  afterEach(async () => {
    for (const child of spawned) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already dead — fine, this is test cleanup.
      }
    }
    spawned = [];
    if (workDir !== undefined) {
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      workDir = undefined;
    }
  });

  it('a session launched by script with a prompt as its argument is discovered, with real cwd and command line', async () => {
    fixture = await createDiscoveryFixture();
    workDir = await mkdtemp(path.join(tmpdir(), 'seeya-process-key-'));
    const child = spawn(process.execPath, [CHILD_SCRIPT, ''], { cwd: workDir, stdio: 'ignore' });
    spawned.push(child);
    const pid = child.pid as number;
    const realCwd = await realpath(workDir);
    await writeRawSessionFile(
      fixture,
      `${pid}.deadbeef.key`,
      'sensitive material — must not be read',
    );

    const result = await discoverSessionsFromProcessKey({
      claudeHome: fixture.claudeHome,
      processControl: realProcessControl,
      now: NOW,
    });

    if (process.platform === 'win32') {
      // D-023: no cwd for an arbitrary pid on Windows without native code — the session is
      // rejected, not invented, and Windows sessions of this shape already have a <pid>.json
      // anyway (this test's whole point is exercising the strategy that Windows doesn't need).
      expect(result.sessions).toStrictEqual([]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.reason).toContain(String(pid));
    } else {
      expect(result.rejected).toStrictEqual([]);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({
        hasPid: true,
        hasSessionId: false,
        pid,
        processIsAlive: true,
        cwd: realCwd,
      });
      expect(result.sessions[0]?.commandLine).toContain('graceful-child.mjs');
    }
  });
});
