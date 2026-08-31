/**
 * E2E nº5 (docs/TESTES.md § E2E): "seeya start-day --all invoca claude --resume com os argumentos
 * certos." Runs the COMPILED `dist/cli/index.js` (via `_harness.ts#runSeeya`) with
 * `HOME`/`USERPROFILE` pointed at a `tmpdir` and a REAL fake `claude` on PATH — never `src/`
 * directly.
 *
 * `seeya start-day` never discovers sessions from `~/.claude/` (D-004: it works entirely from what
 * `end-day` already persisted) — so unlike `end-day.test.ts`, this file writes the handoff
 * directly at `~/.seeya/days/<day>/sessions/<sessionId>.json`, matching
 * `adapters/storage/handoff-schema.ts`'s real on-disk shape, instead of running a full `end-day`
 * first. `localDayString` (a pure, deterministic formatter, `core/day.ts`) is used only to compute
 * WHERE to place the fixture — `buildStartDayContext` uses the real system clock, so the fixture
 * has to sit under today's real local day for `findPendingBriefing` to find it at `daysAgo: 0`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localDayString } from '../../src/core/day.js';
import {
  createE2eHome,
  readLastClaudeCall,
  removeE2eHome,
  runSeeya,
  type E2eHome,
} from './_harness.js';

let home: E2eHome | undefined;

afterEach(async () => {
  if (home !== undefined) {
    await removeE2eHome(home);
    home = undefined;
  }
});

/** A minimal, valid handoff document (`adapters/storage/handoff-schema.ts`'s real shape) written
 * straight to disk — `seeya start-day` reads it back through `Storage.readBriefing`, never through
 * `end-day`'s own pipeline. `source: 'model'` with non-empty `pendingItems` makes this handoff
 * content-pending (`core/pending-briefing.ts`), which is what makes the day findable at all. */
async function writeHandoffFixture(
  home: E2eHome,
  day: string,
  options: { readonly sessionId: string; readonly name: string; readonly cwd: string },
): Promise<void> {
  const dir = path.join(home.seeyaHome, 'days', day, 'sessions');
  await mkdir(dir, { recursive: true });
  await mkdir(options.cwd, { recursive: true });
  const document = {
    schemaVersion: 1,
    sessionId: options.sessionId,
    cwd: options.cwd,
    name: options.name,
    capturedAt: '2026-08-15T21:00:00.000Z',
    sessionState: 'ended',
    capturedDuringActiveTurn: false,
    source: 'model',
    captureMode: 'lean',
    sources: ['registry'],
    facts: {
      lastActivity: null,
      lastPrompts: [],
      assistantMessages: [],
      touchedFiles: [],
      git: null,
    },
    understanding: 'Was refactoring the parser.',
    pendingItems: ['finish the parser refactor'],
    tomorrowPlan: ['ship it'],
    generationError: null,
  };
  await writeFile(path.join(dir, `${options.sessionId}.json`), JSON.stringify(document), 'utf8');
}

describe('e2e: seeya start-day --all (nº5)', () => {
  it('invokes claude --resume with the right sessionId and cwd', async () => {
    home = await createE2eHome();
    const today = localDayString(new Date());
    const session = {
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'project-alpha',
      cwd: path.join(home.root, 'projects', 'alpha'),
    };
    await writeHandoffFixture(home, today, session);

    const result = await runSeeya(home, ['start-day', '--all'], {
      FAKE_CLAUDE_CAPTURE_FILE: home.claudeFixture.captureFile,
    });

    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Resuming 1 of 1');
    expect(result.stdout).toContain('Resumed:');

    const call = await readLastClaudeCall(home);
    expect(call.argv[0]).toBe('--resume');
    expect(call.argv[1]).toBe(session.sessionId);
    expect(call.argv[2]).toContain('finish the parser refactor');

    const resumedRaw = await readFile(
      path.join(home.seeyaHome, 'days', today, 'resumed.json'),
      'utf8',
    );
    expect(JSON.parse(resumedRaw)).toMatchObject({ sessionIds: [session.sessionId] });
  }, 20_000);
});

describe('e2e: seeya start-day, no flags, no TTY (decision: honest "cannot ask", exit 0)', () => {
  it('prints the plan and the flags to use instead of hanging, and never spawns claude', async () => {
    home = await createE2eHome();
    const today = localDayString(new Date());
    await writeHandoffFixture(home, today, {
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'project-beta',
      cwd: path.join(home.root, 'projects', 'beta'),
    });

    // runSeeya's stdio is ['ignore', 'pipe', 'pipe'] — stdin is never a TTY here, the same way it
    // never is for any spawned child in this harness.
    const result = await runSeeya(home, ['start-day']);

    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('project-beta');
    expect(result.stdout).toContain('--all');
    expect(result.stdout).toContain('--session');
    await expect(readLastClaudeCall(home)).rejects.toThrow();
  }, 20_000);
});
