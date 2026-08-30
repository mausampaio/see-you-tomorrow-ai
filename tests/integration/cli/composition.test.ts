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
import {
  buildCliContext,
  buildEndDayContext,
  buildStartDayContext,
  resolveCliHome,
} from '../../../src/cli/composition.js';
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

/**
 * `buildEndDayContext` (S2-T5): the composition step for `seeya end-day`, switching on the two
 * pieces that were "pronto e desligado" until this task — S2-T2's generators and S2-T6's
 * `ForkCleanup` — alongside the git/transcript readers S2-T5 itself is the first caller of. Doesn't
 * spawn a real (or fake) `claude`: that full round trip is covered end-to-end by
 * `tests/e2e/end-day.test.ts`; this integration test's own job is proving the WIRING — every port
 * really is the real adapter, reading the real `config.json`, not a stub silently standing in.
 */
describe('buildEndDayContext', () => {
  it('reads config.json for captureModel/budgetPerSessionUsd/forkCleanupDays and wires every port', async () => {
    fixture = await createDiscoveryFixture();
    await writeFile(
      path.join(fixture.seeyaHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        captureModel: 'opus',
        budgetPerSessionUsd: 0.5,
        forkCleanupDays: 3,
      }),
      'utf8',
    );

    const { deps, config } = await buildEndDayContext(fixture.root);

    expect(config.captureModel).toBe('opus');
    expect(config.budgetPerSessionUsd).toBe(0.5);
    expect(config.forkCleanupDays).toBe(3);
    // Every EndDayDeps field is the real adapter, not left undefined by an incomplete wire-up.
    expect(deps.sessionProvider).toBeDefined();
    expect(deps.transcriptReader).toBeDefined();
    expect(deps.gitReader).toBeDefined();
    expect(deps.leanGenerator).toBeDefined();
    expect(deps.deepGenerator).toBeDefined();
    expect(deps.storage).toBeDefined();
    expect(deps.processControl).toBeDefined();
    expect(deps.forkCleanup).toBeDefined();
  });

  it('the real SessionProvider it wires discovers a fixture session, same as buildCliContext', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, 'stale', {
      pid: 999_999,
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\projeto',
      startedAt: Date.now() - 60_000,
      procStart: 'this-will-never-match-a-real-process',
      name: 'projeto',
    });

    const { deps } = await buildEndDayContext(fixture.root);
    const result = await deps.sessionProvider.list();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ sessionId: '11111111-1111-4111-8111-111111111111' });
  });

  it('the real ForkCleanup it wires reads an empty forks.json without error', async () => {
    fixture = await createDiscoveryFixture();

    const { deps, config } = await buildEndDayContext(fixture.root);
    const result = await deps.forkCleanup.cleanup(config.forkCleanupDays);

    expect(result).toEqual({ outcomes: [], rejected: [] });
  });
});

/**
 * `buildStartDayContext` (S3-T3): proves the wiring, not the command — `Storage` and
 * `SessionResumer` really are the real adapters, reading/writing under the injected root, and
 * `SessionProvider`/git/generation are correctly absent (`seeya start-day` never re-discovers
 * sessions, D-004). No `claude` is spawned here: that full round trip is
 * `tests/e2e/start-day.test.ts`'s job.
 */
describe('buildStartDayContext', () => {
  it('wires a Storage that reads/writes under the injected root, and a SessionResumer', async () => {
    fixture = await createDiscoveryFixture();

    const context = await buildStartDayContext(fixture.root);
    expect(context.sessionResumer).toBeDefined();
    expect(context.clock).toBeDefined();

    // Real StorageAdapter, not a stub: a write really lands under fixture.root and reads back.
    await context.storage.saveResumedSessionIds('2026-08-16', new Set(['session-1']));
    const reread = await context.storage.readResumedSessionIds('2026-08-16');
    expect([...reread]).toEqual(['session-1']);
  });
});
