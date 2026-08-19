/**
 * `discoverSessionsFromTranscriptScan` against a real filesystem, but a fake `~/.claude` +
 * `~/.seeya` built in `tmpdir` (same pattern as registry.test.ts). This is D-016's second
 * strategy (S1-T8): it never touches `~/.claude/sessions/`, only `~/.claude/projects/**\/*.jsonl`.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverSessionsFromTranscriptScan } from '../../../src/adapters/discovery/index.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  transcriptLine,
  writeForksJson,
  writeTranscriptWithContent,
  writeUnreadableTranscriptPlaceholder,
  type DiscoveryFixture,
} from './_fixtures.js';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const RELEVANCE_HOURS = 12;
const ONE_HOUR_MS = 3_600_000;

/** An instant safely inside the relevance window (a few minutes old). */
const RECENT = new Date(NOW.getTime() - 5 * 60_000);
/** An instant safely outside the relevance window. */
const STALE = new Date(NOW.getTime() - (RELEVANCE_HOURS + 1) * ONE_HOUR_MS);

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

async function discover(overrides: Partial<{ now: Date; relevanceHours: number }> = {}) {
  if (fixture === undefined) {
    throw new Error('call createDiscoveryFixture() first');
  }
  return discoverSessionsFromTranscriptScan({
    claudeHome: fixture.claudeHome,
    seeyaHome: fixture.seeyaHome,
    now: overrides.now ?? NOW,
    relevanceHours: overrides.relevanceHours ?? RELEVANCE_HOURS,
  });
}

describe('discoverSessionsFromTranscriptScan — directory shape', () => {
  it('a missing projects directory produces an empty result, not a crash', async () => {
    fixture = await createDiscoveryFixture();
    // Fixture creates projectsDir empty, not missing — remove it to test the "never created" case
    // (same rationale as registry.test.ts's identical comment for sessionsDir).
    await rm(fixture.projectsDir, { recursive: true, force: true });

    const result = await discover();

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('an empty projects directory produces an empty result', async () => {
    fixture = await createDiscoveryFixture();
    await mkdir(path.join(fixture.projectsDir, 'some-slug'), { recursive: true });

    const result = await discover();

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });
});

describe('discoverSessionsFromTranscriptScan — headless session discovery (the reason S1-T8 exists)', () => {
  /**
   * Spike D: `claude -p` writes a transcript but never registers in `~/.claude/sessions/`. This
   * is the acceptance case — a `.jsonl` with no corresponding registry entry still has to be
   * discovered, as `SessionWithoutPid`.
   */
  it('a transcript with no registry entry at all is discovered as SessionWithoutPid', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'c--code-headless',
      SESSION_A,
      transcriptLine('c:\\code\\headless'),
      RECENT,
    );

    const result = await discover();

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toStrictEqual({
      hasPid: false,
      sessionId: SESSION_A,
      cwd: 'c:\\code\\headless',
      name: 'headless',
      hasTranscript: true,
      lastTranscriptWrite: RECENT,
      lastActivity: RECENT,
    });
  });

  it('derives the display name from cwd, same convention as the registry strategy (D-021)', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_A,
      transcriptLine('/home/<usuario>/projects/meu-projeto'),
      RECENT,
    );

    const result = await discover();

    expect(result.sessions[0]?.name).toBe('meu-projeto');
  });

  it('discovers sessions across multiple project slugs independently', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'slug-a',
      SESSION_A,
      transcriptLine('c:\\code\\projeto-01'),
      RECENT,
    );
    await writeTranscriptWithContent(
      fixture,
      'slug-b',
      SESSION_B,
      transcriptLine('c:\\code\\projeto-02'),
      RECENT,
    );

    const result = await discover();

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.map((s) => s.sessionId).sort()).toStrictEqual(
      [SESSION_A, SESSION_B].sort(),
    );
  });
});

describe('discoverSessionsFromTranscriptScan — relevanceHours filter (D-016)', () => {
  it('a transcript with an mtime older than relevanceHours is not discovered', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_A,
      transcriptLine('c:\\code\\old'),
      STALE,
    );

    const result = await discover();

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('a transcript right at the edge of the window (exactly relevanceHours old) is still discovered', async () => {
    fixture = await createDiscoveryFixture();
    const atTheEdge = new Date(NOW.getTime() - RELEVANCE_HOURS * ONE_HOUR_MS);
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_A,
      transcriptLine('c:\\code\\edge'),
      atTheEdge,
    );

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
  });

  it('a smaller relevanceHours excludes a transcript a larger one would have included', async () => {
    fixture = await createDiscoveryFixture();
    const sixHoursAgo = new Date(NOW.getTime() - 6 * ONE_HOUR_MS);
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_A,
      transcriptLine('c:\\code\\projeto'),
      sixHoursAgo,
    );

    const excluded = await discover({ relevanceHours: 1 });
    const included = await discover({ relevanceHours: 12 });

    expect(excluded.sessions).toStrictEqual([]);
    expect(included.sessions).toHaveLength(1);
  });

  /**
   * Acceptance item 2 (docs/PLANO-DE-ENTREGA.md S1-T8): "um `~/.claude` falso com 500 transcripts
   * é filtrado sem parse de conteúdo" — proved by execution, not by reading the implementation.
   * Every stale item here is a *directory* named like a transcript file
   * (`writeUnreadableTranscriptPlaceholder`): `stat` succeeds (so the mtime filter can see and
   * skip it), but if the scan ever tried to open one as file content, that would fail
   * (`EISDIR`) and — per this adapter's D-022 contract — surface as a visible rejection. None do:
   * `rejected` comes back empty, which is only possible if all 500 stale placeholders were
   * skipped by `stat` alone and never opened.
   */
  it('500 stale transcripts are filtered by mtime alone, never opened as content', async () => {
    fixture = await createDiscoveryFixture();
    const slugDir = 'huge-history';

    await Promise.all(
      Array.from({ length: 500 }, () =>
        writeUnreadableTranscriptPlaceholder(fixture!, slugDir, randomUUID(), STALE),
      ),
    );
    await writeTranscriptWithContent(
      fixture,
      slugDir,
      SESSION_A,
      transcriptLine('c:\\code\\projeto-relevante'),
      RECENT,
    );

    const result = await discover();

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe(SESSION_A);
  }, 30_000);

  /**
   * The control case for the test above: the same unreadable-directory placeholder, but *inside*
   * the relevance window. If the scan is really only skipping stale files by mtime (and not, say,
   * silently ignoring every directory-shaped `.jsonl` regardless of age — which would make the
   * test above pass for the wrong reason), this one has to surface a rejection.
   */
  it('an unreadable placeholder inside the window is surfaced as a rejection, not silently skipped', async () => {
    fixture = await createDiscoveryFixture();
    await writeUnreadableTranscriptPlaceholder(fixture, 'slug', SESSION_A, RECENT);

    const result = await discover();

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toEqual(expect.any(String));
  });
});

describe('discoverSessionsFromTranscriptScan — fork exclusion (D-012)', () => {
  it('a transcript whose file name is a sessionId listed in forks.json is excluded — not a session, not a rejection', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_A,
      transcriptLine('c:\\code\\fork'),
      RECENT,
    );
    await writeForksJson(fixture, [{ sessionId: SESSION_A }]);

    const result = await discover();

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('an unrelated sessionId in forks.json does not affect a real transcript', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_B,
      transcriptLine('c:\\code\\projeto'),
      RECENT,
    );
    await writeForksJson(fixture, [{ sessionId: SESSION_A }]);

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe(SESSION_B);
  });

  it('a corrupted forks.json is surfaced as a rejection but does not block a real transcript from being discovered', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_A,
      transcriptLine('c:\\code\\projeto'),
      RECENT,
    );
    await writeFile(path.join(fixture.seeyaHome, 'forks.json'), 'not json {{{', 'utf8');

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toMatch(/forks\.json$/);
  });
});

describe('discoverSessionsFromTranscriptScan — truncated content (docs/TESTES.md)', () => {
  /**
   * The Claude Code process can be mid-write when `seeya` scans. A truncated last line must never
   * take the session — or the batch — down.
   */
  it('a session whose transcript ends in a truncated line, but has a readable cwd earlier, is still discovered', async () => {
    fixture = await createDiscoveryFixture();
    const content = `${transcriptLine('c:\\code\\projeto-em-escrita')}{"type":"assistant","cwd":"c:\\\\trunc`;
    await writeTranscriptWithContent(fixture, 'slug', SESSION_A, content, RECENT);

    const result = await discover();

    expect(result.rejected).toStrictEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.cwd).toBe('c:\\code\\projeto-em-escrita');
  });

  it('a transcript that is only a truncated line (no cwd readable anywhere) is rejected, not thrown, and does not block another session', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_A,
      '{"type":"user","cwd":"c:\\\\ain',
      RECENT,
    );
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_B,
      transcriptLine('c:\\code\\projeto-normal'),
      RECENT,
    );

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe(SESSION_B);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toMatch(new RegExp(`${SESSION_A}\\.jsonl$`));
    expect(result.rejected[0]?.reason).toEqual(expect.any(String));
  });
});

describe('discoverSessionsFromTranscriptScan — malformed items (D-022)', () => {
  it('a .jsonl file whose name is not a valid uuid is rejected, not thrown, and does not block a real session', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'slug',
      'not-a-uuid',
      transcriptLine('c:\\code\\weird'),
      RECENT,
    );
    await writeTranscriptWithContent(
      fixture,
      'slug',
      SESSION_A,
      transcriptLine('c:\\code\\projeto-normal'),
      RECENT,
    );

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe(SESSION_A);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('not a valid session id');
  });

  it('a slug entry that is a file, not a directory, is reported as one rejection and does not block other slugs', async () => {
    fixture = await createDiscoveryFixture();
    await writeFile(path.join(fixture.projectsDir, 'not-a-directory'), 'stray file', 'utf8');
    await writeTranscriptWithContent(
      fixture,
      'real-slug',
      SESSION_A,
      transcriptLine('c:\\code\\projeto'),
      RECENT,
    );

    const result = await discover();

    expect(result.sessions).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toContain('not-a-directory');
  });

  it('a non-.jsonl file sitting in a slug directory is ignored, never treated as a candidate', async () => {
    fixture = await createDiscoveryFixture();
    const slugDir = path.join(fixture.projectsDir, 'slug');
    await mkdir(slugDir, { recursive: true });
    await writeFile(path.join(slugDir, 'notes.txt'), 'not a transcript', 'utf8');

    const result = await discover();

    expect(result).toStrictEqual({ sessions: [], rejected: [] });
  });

  it('the projects directory not actually being a directory is reported, not thrown', async () => {
    fixture = await createDiscoveryFixture();
    await rm(fixture.projectsDir, { recursive: true, force: true });
    await writeFile(fixture.projectsDir, 'this is a file where a directory was expected', 'utf8');

    const result = await discover();

    expect(result.sessions).toStrictEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toBe(fixture.projectsDir);
  });
});
