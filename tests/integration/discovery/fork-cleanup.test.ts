/**
 * `DiscoveryForkCleanup` (D-012, S2-T6) against a fake `~/.claude` + `~/.seeya` in `tmpdir` —
 * never the real `~/.claude/projects/` (AGENTS.md § "Sistema de arquivos": this project's one
 * exception to "nunca escreva em `~/.claude/`" is narrow enough that it has to be proven narrow,
 * not just argued).
 *
 * The central proof (docs/PLANO-DE-ENTREGA.md S2-T6's acceptance, item 2) is `containment`,
 * below: a full snapshot of `~/.claude/projects/` before and after `cleanup()`, asserting the only
 * difference is the one file a stale, registered fork was supposed to lose. Same instrument
 * `tests/integration/git/git-adapter.test.ts` already uses for its own "never writes" proof,
 * applied here to file presence/content instead of git state.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiscoveryForkCleanup } from '../../../src/adapters/discovery/fork-cleanup.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  writeForksJson,
  writeForksJsonRaw,
  writeTranscript,
  writeUnreadableTranscriptPlaceholder,
  type DiscoveryFixture,
} from './_fixtures.js';
import { FakeClock } from './_fake-clock.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const FORK_CLEANUP_DAYS = 7;

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

const REAL_SESSION = '11111111-1111-4111-8111-111111111111';
const RECENT_FORK = '22222222-2222-4222-8222-222222222222';
const STALE_FORK = '33333333-3333-4333-8333-333333333333';
const STALE_MISSING_FORK = '44444444-4444-4444-8444-444444444444';
const STALE_LOCKED_FORK = '55555555-5555-4555-8555-555555555555';

interface TreeEntry {
  readonly kind: 'file' | 'dir';
  readonly content?: string;
  readonly mtimeMs?: number;
}

/** Recursively snapshots every entry under `dir` — content and mtime for files, presence alone
 * for directories (a directory here always stands in for a deliberately undeletable transcript
 * placeholder, per `writeUnreadableTranscriptPlaceholder`'s own docstring, never a slug with
 * further nesting worth distinguishing). Keyed by POSIX-style relative path so the snapshot
 * doesn't depend on the host's path separator. */
async function snapshotTree(dir: string): Promise<Record<string, TreeEntry>> {
  const result: Record<string, TreeEntry> = {};

  async function walk(currentDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        result[relPath] = { kind: 'dir' };
        await walk(absPath, relPath);
      } else {
        const [content, stats] = await Promise.all([readFile(absPath, 'utf8'), stat(absPath)]);
        result[relPath] = { kind: 'file', content, mtimeMs: stats.mtimeMs };
      }
    }
  }

  await walk(dir, '');
  return result;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

let fixture: DiscoveryFixture;

beforeEach(async () => {
  fixture = await createDiscoveryFixture();
});

afterEach(async () => {
  await removeDiscoveryFixture(fixture);
});

describe('DiscoveryForkCleanup.cleanup — containment (S2-T6 acceptance item 2)', () => {
  it("touches only the stale, registered fork's own file — a real session transcript and a fork still within the deadline are byte-for-byte untouched", async () => {
    await writeTranscript(fixture, 'slug-real-project', REAL_SESSION);
    await writeTranscript(fixture, 'slug-forks', RECENT_FORK);
    await writeTranscript(fixture, 'slug-forks', STALE_FORK);
    await writeUnreadableTranscriptPlaceholder(
      fixture,
      'slug-forks',
      STALE_LOCKED_FORK,
      new Date(NOW.getTime() - 10 * DAY_MS),
    );
    await writeForksJson(fixture, [
      { sessionId: RECENT_FORK, createdAt: isoDaysAgo(1) },
      { sessionId: STALE_FORK, createdAt: isoDaysAgo(10) },
      { sessionId: STALE_MISSING_FORK, createdAt: isoDaysAgo(10) },
      { sessionId: STALE_LOCKED_FORK, createdAt: isoDaysAgo(10) },
    ]);

    const before = await snapshotTree(fixture.projectsDir);

    const cleanup = new DiscoveryForkCleanup({
      claudeHome: fixture.claudeHome,
      seeyaHome: fixture.seeyaHome,
      clock: new FakeClock(NOW),
    });
    const result = await cleanup.cleanup(FORK_CLEANUP_DAYS);

    const after = await snapshotTree(fixture.projectsDir);

    // The ONLY change anywhere under ~/.claude/projects/ is STALE_FORK's own file disappearing.
    // Any other touch — content, mtime, an unexpected deletion — would fail this comparison.
    const expectedAfter = { ...before };
    delete expectedAfter[`slug-forks/${STALE_FORK}.jsonl`];
    expect(after).toStrictEqual(expectedAfter);

    // Named assertions on top of the snapshot, for a readable failure message.
    expect(
      await fileExists(path.join(fixture.projectsDir, 'slug-forks', `${STALE_FORK}.jsonl`)),
    ).toBe(false);
    expect(
      await fileExists(
        path.join(fixture.projectsDir, 'slug-real-project', `${REAL_SESSION}.jsonl`),
      ),
    ).toBe(true);
    expect(
      await fileExists(path.join(fixture.projectsDir, 'slug-forks', `${RECENT_FORK}.jsonl`)),
    ).toBe(true);
    expect(
      await fileExists(path.join(fixture.projectsDir, 'slug-forks', `${STALE_LOCKED_FORK}.jsonl`)),
    ).toBe(true);

    const outcomesBySession = new Map(
      result.outcomes.map((outcome) => [outcome.sessionId, outcome]),
    );
    expect(outcomesBySession.get(STALE_FORK)).toStrictEqual({
      sessionId: STALE_FORK,
      outcome: 'deleted',
    });
    expect(outcomesBySession.get(STALE_MISSING_FORK)).toStrictEqual({
      sessionId: STALE_MISSING_FORK,
      outcome: 'alreadyAbsent',
    });
    expect(outcomesBySession.get(STALE_LOCKED_FORK)?.outcome).toBe('failed');
    // RECENT_FORK was never stale — planForkCleanup never hands it to the deletion step at all,
    // so it never gets an outcome, not even a "kept" one (core/ports.ts#ForkCleanupOutcome's
    // docstring: this list only ever names forks actually attempted).
    expect(outcomesBySession.has(RECENT_FORK)).toBe(false);
    expect(result.outcomes).toHaveLength(3);
    expect(result.rejected).toStrictEqual([]);
  });

  it('rewrites forks.json dropping only deleted/alreadyAbsent entries — a failed deletion is kept for retry, an entry never stale is kept untouched', async () => {
    await writeTranscript(fixture, 'slug-forks', RECENT_FORK);
    await writeTranscript(fixture, 'slug-forks', STALE_FORK);
    await writeUnreadableTranscriptPlaceholder(
      fixture,
      'slug-forks',
      STALE_LOCKED_FORK,
      new Date(NOW.getTime() - 10 * DAY_MS),
    );
    await writeForksJson(fixture, [
      { sessionId: RECENT_FORK, createdAt: isoDaysAgo(1) },
      { sessionId: STALE_FORK, createdAt: isoDaysAgo(10) },
      { sessionId: STALE_MISSING_FORK, createdAt: isoDaysAgo(10) },
      { sessionId: STALE_LOCKED_FORK, createdAt: isoDaysAgo(10) },
    ]);

    const cleanup = new DiscoveryForkCleanup({
      claudeHome: fixture.claudeHome,
      seeyaHome: fixture.seeyaHome,
      clock: new FakeClock(NOW),
    });
    await cleanup.cleanup(FORK_CLEANUP_DAYS);

    const registryText = await readFile(path.join(fixture.seeyaHome, 'forks.json'), 'utf8');
    const registry = JSON.parse(registryText) as { forks: Array<{ sessionId: string }> };
    expect(registry.forks.map((entry) => entry.sessionId).sort()).toStrictEqual(
      [RECENT_FORK, STALE_LOCKED_FORK].sort(),
    );
  });

  it('a fork registered with no matching file anywhere is reported alreadyAbsent, not an error, and does not block the batch (D-025)', async () => {
    await writeForksJson(fixture, [{ sessionId: STALE_MISSING_FORK, createdAt: isoDaysAgo(30) }]);

    const cleanup = new DiscoveryForkCleanup({
      claudeHome: fixture.claudeHome,
      seeyaHome: fixture.seeyaHome,
      clock: new FakeClock(NOW),
    });
    const result = await cleanup.cleanup(FORK_CLEANUP_DAYS);

    expect(result.outcomes).toStrictEqual([
      { sessionId: STALE_MISSING_FORK, outcome: 'alreadyAbsent' },
    ]);
  });

  it('a failed deletion does not prevent other stale forks from being deleted (D-022)', async () => {
    const secondStale = '66666666-6666-4666-8666-666666666666';
    await writeUnreadableTranscriptPlaceholder(
      fixture,
      'slug-forks',
      STALE_LOCKED_FORK,
      new Date(NOW.getTime() - 10 * DAY_MS),
    );
    await writeTranscript(fixture, 'slug-forks', secondStale);
    await writeForksJson(fixture, [
      { sessionId: STALE_LOCKED_FORK, createdAt: isoDaysAgo(10) },
      { sessionId: secondStale, createdAt: isoDaysAgo(10) },
    ]);

    const cleanup = new DiscoveryForkCleanup({
      claudeHome: fixture.claudeHome,
      seeyaHome: fixture.seeyaHome,
      clock: new FakeClock(NOW),
    });
    const result = await cleanup.cleanup(FORK_CLEANUP_DAYS);

    const outcomesBySession = new Map(
      result.outcomes.map((outcome) => [outcome.sessionId, outcome]),
    );
    expect(outcomesBySession.get(STALE_LOCKED_FORK)?.outcome).toBe('failed');
    expect(outcomesBySession.get(secondStale)).toStrictEqual({
      sessionId: secondStale,
      outcome: 'deleted',
    });
    expect(
      await fileExists(path.join(fixture.projectsDir, 'slug-forks', `${secondStale}.jsonl`)),
    ).toBe(false);
  });

  it('a malformed forks.json entry is visible in rejected and does not stop a valid stale fork from being cleaned up (D-022)', async () => {
    await writeTranscript(fixture, 'slug-forks', STALE_FORK);
    await writeForksJsonRaw(fixture, {
      schemaVersion: 1,
      forks: [{ notASessionId: 'oops' }, { sessionId: STALE_FORK, createdAt: isoDaysAgo(10) }],
    });

    const cleanup = new DiscoveryForkCleanup({
      claudeHome: fixture.claudeHome,
      seeyaHome: fixture.seeyaHome,
      clock: new FakeClock(NOW),
    });
    const result = await cleanup.cleanup(FORK_CLEANUP_DAYS);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.raw).toStrictEqual({ notASessionId: 'oops' });
    expect(result.outcomes).toStrictEqual([{ sessionId: STALE_FORK, outcome: 'deleted' }]);
  });

  it('no forks.json at all: nothing to clean up, and forks.json is never created just to say so', async () => {
    const cleanup = new DiscoveryForkCleanup({
      claudeHome: fixture.claudeHome,
      seeyaHome: fixture.seeyaHome,
      clock: new FakeClock(NOW),
    });

    const result = await cleanup.cleanup(FORK_CLEANUP_DAYS);

    expect(result).toStrictEqual({ outcomes: [], rejected: [] });
    expect(await fileExists(path.join(fixture.seeyaHome, 'forks.json'))).toBe(false);
  });

  it('every fork still within forkCleanupDays: forks.json is left byte-identical (no write at all)', async () => {
    await writeTranscript(fixture, 'slug-forks', RECENT_FORK);
    await writeForksJson(fixture, [{ sessionId: RECENT_FORK, createdAt: isoDaysAgo(1) }]);
    const registryPath = path.join(fixture.seeyaHome, 'forks.json');
    const before = await readFile(registryPath, 'utf8');

    const cleanup = new DiscoveryForkCleanup({
      claudeHome: fixture.claudeHome,
      seeyaHome: fixture.seeyaHome,
      clock: new FakeClock(NOW),
    });
    const result = await cleanup.cleanup(FORK_CLEANUP_DAYS);

    expect(result).toStrictEqual({ outcomes: [], rejected: [] });
    expect(await readFile(registryPath, 'utf8')).toBe(before);
  });
});
