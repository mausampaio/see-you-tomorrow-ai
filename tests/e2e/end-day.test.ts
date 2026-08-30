/**
 * E2E nº2, nº3 and nº4 (docs/TESTES.md § E2E) plus S2-T5's own `--session` acceptance point,
 * which isn't one of the eight numbered journeys but is required by
 * docs/PLANO-DE-ENTREGA.md S2-T5 all the same. Runs the COMPILED `dist/cli/index.js` (via
 * `_harness.ts#runSeeya`) with `HOME`/`USERPROFILE` pointed at a `tmpdir` and a REAL fake `claude`
 * on PATH (`_harness.ts`'s `createFakeClaudeFixture` reuse, S2-T5) — never `src/` directly.
 *
 * No session here needs a real spawned child process: `core/eligibility.ts`'s five conditions
 * never look at liveness, only at `lastActivity` — a registry entry with a recent `startedAt` is
 * discovered, classified `ended` (a dead/fake pid), and is still perfectly eligible. `cwd` points
 * at a real, empty directory (needed so the lean generator can actually spawn the fake `claude`
 * there — `spawn`'s own `cwd` option fails on a directory that doesn't exist) that is deliberately
 * NOT inside `home.homeDir`, so it never appears in nº2's whole-tree snapshot at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  createE2eHome,
  removeE2eHome,
  runSeeya,
  writeSessionRecord,
  type E2eHome,
} from './_harness.js';

let home: E2eHome | undefined;

afterEach(async () => {
  if (home !== undefined) {
    await removeE2eHome(home);
    home = undefined;
  }
});

/** Recursively snapshots every file under `dir` — content and mtime, keyed by POSIX-style
 * relative path so the result doesn't depend on the host's path separator. Same instrument
 * `tests/integration/git/git-adapter.test.ts` and `tests/integration/discovery/fork-cleanup.test.ts`
 * already use for their own "never writes" proofs, applied here to the whole `~/.seeya`+`~/.claude`
 * tree instead of just one of them — docs/PLANO-DE-ENTREGA.md S2-T5 asks explicitly for this exact
 * instrument, not a narrower assertion. */
async function snapshotTree(
  dir: string,
): Promise<Record<string, { content: string; mtimeMs: number }>> {
  const result: Record<string, { content: string; mtimeMs: number }> = {};
  async function walk(currentDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
      } else {
        const [content, stats] = await Promise.all([readFile(absPath, 'utf8'), stat(absPath)]);
        result[relPath] = { content, mtimeMs: stats.mtimeMs };
      }
    }
  }
  await walk(dir, '');
  return result;
}

/** A registry-only session record, eligible by `core/eligibility.ts`'s rules (recent `startedAt`,
 * no ignore/fork/duplicate) without any live process or transcript — see this file's own top
 * comment for why that is enough. `cwd` must be a REAL directory (the lean generator spawns
 * `claude` there) but is never a git repository — keeping evidence to `sources: ["registry"]` on
 * purpose, since these journeys are about the end-day PIPELINE, not re-proving D-013's multi-source
 * merge, already covered by `tests/unit/application`. */
async function writeEligibleSession(
  home: E2eHome,
  fileName: string,
  options: { readonly sessionId: string; readonly name: string; readonly cwd: string },
): Promise<void> {
  await mkdir(options.cwd, { recursive: true });
  await writeSessionRecord(home, fileName, {
    pid: 900_000, // Never a real, live PID (docs/ESPECIFICACAO.md's eligibility never checks liveness).
    sessionId: options.sessionId,
    cwd: options.cwd,
    startedAt: Date.now() - 60_000,
    procStart: 'e2e-fake-proc-start',
    name: options.name,
  });
}

/** The canned `claude -p --output-format json --json-schema ...` response (S2-T2, confirmed real
 * shape) `run-generation.ts` parses — `structured_output` first, per
 * `adapters/generation/run-generation.ts#extractUnderstanding`'s own preference. */
function canonicalSuccessStdout(understanding: string): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 800,
    num_turns: 1,
    result: JSON.stringify({
      understanding,
      pendingItems: ['finish it'],
      tomorrowPlan: ['ship it'],
    }),
    session_id: '11111111-1111-4111-8111-111111111111',
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 5,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: '22222222-2222-4222-8222-222222222222',
    structured_output: { understanding, pendingItems: ['finish it'], tomorrowPlan: ['ship it'] },
  });
}

async function findDayDir(seeyaHome: string): Promise<string> {
  const daysDir = path.join(seeyaHome, 'days');
  const entries = await readdir(daysDir);
  if (entries.length !== 1) {
    throw new Error(
      `expected exactly one day directory under ${daysDir}, found: ${entries.join(', ')}`,
    );
  }
  const entry = entries[0];
  if (entry === undefined) {
    throw new Error(`expected exactly one day directory under ${daysDir}, found none`);
  }
  return path.join(daysDir, entry);
}

describe('e2e: seeya end-day --dry-run (nº2)', () => {
  it('describes what it would do and writes NOTHING — proved by a whole-tree snapshot, not an assertion', async () => {
    home = await createE2eHome();
    const projectDir = path.join(home.root, 'projects', 'dry-run-project');
    await writeEligibleSession(home, 'dry-run-session', {
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'dry-run-project',
      cwd: projectDir,
    });

    const before = await snapshotTree(home.homeDir);

    const result = await runSeeya(home, ['end-day', '--dry-run'], {
      FAKE_CLAUDE_MODE: 'success',
      FAKE_CLAUDE_STDOUT: canonicalSuccessStdout('would capture this session for real'),
    });

    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('dry run — nothing is written or terminated');
    expect(result.stdout).toContain('dry-run-project');
    expect(result.stdout).toContain('would capture this session for real');
    expect(result.stdout).toContain('Briefing preview (not written):');
    expect(result.stdout).toContain('Fork cleanup: skipped');
    // The negative space matters as much as the positive: a dry run never claims to have written.
    expect(result.stdout).not.toContain('Wrote ');

    const after = await snapshotTree(home.homeDir);
    // The single instrument this project already uses for "did this touch disk" (S2-T1, S2-T6):
    // a full snapshot, content AND mtime, of the whole tree `--dry-run` must never touch — not
    // `~/.seeya/days/`, not `~/.seeya/config.json`, not `~/.seeya/forks.json`, not anything under
    // `~/.claude/` either. Equal to the byte and the millisecond, or this test fails.
    expect(after).toStrictEqual(before);
  }, 20_000);
});

describe('e2e: seeya end-day (nº3) and --session (S2-T5 acceptance)', () => {
  it('generates handoffs and a briefing with the expected content, and --session limits to one', async () => {
    home = await createE2eHome();
    const alpha = {
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'project-alpha',
      cwd: path.join(home.root, 'projects', 'alpha'),
    };
    const beta = {
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'project-beta',
      cwd: path.join(home.root, 'projects', 'beta'),
    };
    await writeEligibleSession(home, 'alpha-session', alpha);
    await writeEligibleSession(home, 'beta-session', beta);
    const claudeEnv = {
      FAKE_CLAUDE_MODE: 'success',
      FAKE_CLAUDE_STDOUT: canonicalSuccessStdout('captured real understanding'),
    };

    // --session first: only alpha may be captured this run.
    const sessionRun = await runSeeya(home, ['end-day', '--session', alpha.sessionId], claudeEnv);
    expect(sessionRun.exitCode, `stderr: ${sessionRun.stderr}`).toBe(0);

    const dayDir = await findDayDir(home.seeyaHome);
    const alphaHandoffPath = path.join(dayDir, 'sessions', `${alpha.sessionId}.json`);
    const betaHandoffPath = path.join(dayDir, 'sessions', `${beta.sessionId}.json`);

    const alphaHandoff = JSON.parse(await readFile(alphaHandoffPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(alphaHandoff['sessionId']).toBe(alpha.sessionId);
    expect(alphaHandoff['name']).toBe(alpha.name);
    expect(alphaHandoff['source']).toBe('model');
    expect(alphaHandoff['captureMode']).toBe('lean');
    expect(alphaHandoff['understanding']).toBe('captured real understanding');
    expect(alphaHandoff['pendingItems']).toEqual(['finish it']);
    expect(alphaHandoff['tomorrowPlan']).toEqual(['ship it']);

    await expect(readFile(betaHandoffPath, 'utf8')).rejects.toThrow(/ENOENT/);

    const summaryAfterSession = await readFile(path.join(dayDir, 'summary.md'), 'utf8');
    expect(summaryAfterSession).toContain(alpha.name);
    expect(summaryAfterSession).toContain('captured real understanding');
    expect(summaryAfterSession).not.toContain(beta.name);

    // Now a full run: beta gets captured too, and the SAME summary.md consolidates both — proving
    // application/briefing.ts#writeDailyBriefing rereads everything persisted today, not just this
    // run's own captures (docs/PLANO-DE-ENTREGA.md S2-T4/S2-T5's own acceptance).
    const fullRun = await runSeeya(home, ['end-day'], claudeEnv);
    expect(fullRun.exitCode, `stderr: ${fullRun.stderr}`).toBe(0);

    const betaHandoff = JSON.parse(await readFile(betaHandoffPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(betaHandoff['name']).toBe(beta.name);
    expect(betaHandoff['source']).toBe('model');

    const summaryAfterFull = await readFile(path.join(dayDir, 'summary.md'), 'utf8');
    expect(summaryAfterFull).toContain(alpha.name);
    expect(summaryAfterFull).toContain(beta.name);
    expect(fullRun.stdout).toContain('Wrote ');
  }, 20_000);

  it('a --session value matching no discovered session says so, instead of silently capturing nothing', async () => {
    home = await createE2eHome();
    await writeEligibleSession(home, 'only-session', {
      sessionId: '33333333-3333-4333-8333-333333333333',
      name: 'only-project',
      cwd: path.join(home.root, 'projects', 'only'),
    });

    const result = await runSeeya(home, ['end-day', '--session', 'does-not-exist']);

    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('No discovered session matches "does-not-exist"');
    expect(result.stdout).toContain('1 session(s) were discovered in total');
  }, 20_000);
});

describe('e2e: seeya end-day with a failing claude (nº4)', () => {
  it(
    'generates a deterministic handoff and briefing, and exits successfully — a model failure ' +
      'is not a failed day (D-003)',
    async () => {
      home = await createE2eHome();
      const session = {
        sessionId: '44444444-4444-4444-8444-444444444444',
        name: 'flaky-project',
        cwd: path.join(home.root, 'projects', 'flaky'),
      };
      await writeEligibleSession(home, 'flaky-session', session);

      const result = await runSeeya(home, ['end-day'], {
        FAKE_CLAUDE_MODE: 'nonzero',
        FAKE_CLAUDE_EXIT_CODE: '1',
      });

      // The crux of nº4: the model being unavailable is NOT a failed command.
      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);

      const dayDir = await findDayDir(home.seeyaHome);
      const handoffPath = path.join(dayDir, 'sessions', `${session.sessionId}.json`);
      const handoff = JSON.parse(await readFile(handoffPath, 'utf8')) as Record<string, unknown>;
      expect(handoff['source']).toBe('deterministic');
      expect(handoff['understanding']).toBe('');
      expect(handoff['generationError']).toMatch(/claude exited with code 1/);

      const summary = await readFile(path.join(dayDir, 'summary.md'), 'utf8');
      expect(summary).toContain(session.name);
      expect(summary).toContain('Understanding not available for this session.');

      expect(result.stdout).toContain('Understanding not available:');
    },
    20_000,
  );
});
