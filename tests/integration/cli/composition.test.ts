/**
 * `src/cli/composition.ts` — the project's only composition root (D-020) — exercised for real:
 * a real `StorageAdapter` reading `config.json` from a `tmpdir`, and a real `DiscoverySessionProvider`
 * wired to the real `adapters/process` `ProcessControl` (not `FakeProcessControl`). Unlike
 * `sessions-command.test.ts`/`status-command.test.ts`, which build their own fakes to isolate the
 * command logic, this file's whole point is proving the wiring itself — that `buildCliContext`
 * really does hand back ports that work against the real OS and real disk, the same shape of proof
 * `tests/integration/process/liveness.test.ts` gives `adapters/process` on its own.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCliContext, resolveCliHome } from '../../../src/cli/composition.js';
import { captureObservedProcStart } from '../../../src/adapters/process/proc-start.js';
import { processExists } from '../../../src/adapters/process/existence.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  writeSessionRecord,
  type DiscoveryFixture,
} from '../discovery/_fixtures.js';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

describe('resolveCliHome', () => {
  it('joins the injected home directory into .claude/.seeya, never calling os.homedir() itself', () => {
    const home = resolveCliHome(path.join('c:', 'fake', 'home'));

    expect(home.claudeHome).toBe(path.join('c:', 'fake', 'home', '.claude'));
    expect(home.seeyaHome).toBe(path.join('c:', 'fake', 'home', '.seeya'));
  });
});

describe('buildCliContext', () => {
  it('reads config.json for relevanceHours and wires a SessionProvider that discovers real fixture sessions', async () => {
    fixture = await createDiscoveryFixture();
    await writeFile(
      path.join(fixture.seeyaHome, 'config.json'),
      JSON.stringify({ schemaVersion: 1, relevanceHours: 6 }),
      'utf8',
    );
    // A dead PID keeps this test independent of any real running process — discovery still has
    // to find and report the entry (as "ended"), which is all this test needs to prove wiring.
    await writeSessionRecord(fixture, 'stale', {
      pid: 999_999,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\projeto',
      startedAt: Date.now() - 60_000,
      procStart: 'this-will-never-match-a-real-process',
      name: 'projeto',
    });

    const context = await buildCliContext(fixture.root);

    expect(context.config.relevanceHours).toBe(6);
    const result = await context.sessionProvider.list();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ sessionId: '11111111-1111-4111-8111-111111111111' });
  });

  it('falls back to Config defaults when config.json does not exist yet (D-025)', async () => {
    fixture = await createDiscoveryFixture();

    const context = await buildCliContext(fixture.root);

    expect(context.config.relevanceHours).toBe(12);
    expect(context.config.idleMinutes).toBe(45);
  });

  /**
   * The one test in this file that proves the REAL `ProcessControl` (not a fake) is what
   * `buildCliContext` wires in: this test process's own PID is genuinely alive right now, and its
   * real `procStart` really round-trips through the OS-querying adapter — the same proof
   * `tests/integration/process/liveness.test.ts` gives `adapters/process` alone, done here through
   * the composition root instead.
   */
  it('the real ProcessControl reports this test process itself as alive', async () => {
    fixture = await createDiscoveryFixture();
    const pid = process.pid;
    const capture = await captureObservedProcStart(pid, processExists);
    if (capture.kind !== 'value') {
      throw new Error(
        `expected a real procStart capture for pid ${pid}, got ${JSON.stringify(capture)}`,
      );
    }
    await writeSessionRecord(fixture, 'self', {
      pid,
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: 'c:\\code\\self',
      startedAt: Date.now() - 60_000,
      procStart: capture.value,
      name: 'self',
    });

    const context = await buildCliContext(fixture.root);
    const result = await context.sessionProvider.list();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ hasPid: true, processIsAlive: true });
  });
});
