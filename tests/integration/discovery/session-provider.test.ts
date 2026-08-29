/**
 * `DiscoverySessionProvider` (S1-T9) end-to-end against a real filesystem: the same fake
 * `~/.claude` + `~/.seeya` fixture `registry.test.ts` and `transcript-scan.test.ts` use, but run
 * through the actual `SessionProvider` implementation instead of calling either strategy alone —
 * this is what proves the *merge*, not just that each strategy still works on its own.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DiscoverySessionProvider } from '../../../src/adapters/discovery/index.js';
import { FakeProcessControl } from './_fake-process-control.js';
import { FakeClock } from './_fake-clock.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  transcriptLine,
  writeSessionRecord,
  writeTranscriptWithContent,
  writeUnreadableTranscriptPlaceholder,
  type DiscoveryFixture,
} from './_fixtures.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const RELEVANCE_HOURS = 12;
const RECENT = new Date(NOW.getTime() - 5 * 60_000);

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pid: 4242,
    sessionId: SESSION_A,
    cwd: 'c:\\code\\projeto-01',
    startedAt: NOW.getTime() - 60 * 60_000,
    procStart: '999999000011112222',
    name: 'projeto-01',
    ...overrides,
  };
}

function list() {
  if (fixture === undefined) {
    throw new Error('call createDiscoveryFixture() first');
  }
  const provider = new DiscoverySessionProvider({
    claudeHome: fixture.claudeHome,
    seeyaHome: fixture.seeyaHome,
    processControl: new FakeProcessControl(),
    clock: new FakeClock(NOW),
    relevanceHours: RELEVANCE_HOURS,
  });
  return provider.list();
}

describe('DiscoverySessionProvider — sessions found by only one strategy', () => {
  it('a registry-only session is discovered in the registry shape (hasPid: true)', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());

    const result = await list();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ hasPid: true, sessionId: SESSION_A });
  });

  it('a transcript-scan-only (headless) session is discovered in that shape (hasPid: false)', async () => {
    fixture = await createDiscoveryFixture();
    await writeTranscriptWithContent(
      fixture,
      'c--code-headless',
      SESSION_B,
      transcriptLine('c:\\code\\headless'),
      RECENT,
    );

    const result = await list();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ hasPid: false, sessionId: SESSION_B });
  });
});

describe('DiscoverySessionProvider — the same session in both strategies appears once, fused', () => {
  it('a session with a registry entry and a matching transcript is a single, fused entry', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await writeTranscriptWithContent(
      fixture,
      'c--code-projeto-01',
      SESSION_A,
      transcriptLine('c:\\code\\projeto-01'),
      RECENT,
    );

    const result = await list();

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session).toMatchObject({
      hasPid: true,
      sessionId: SESSION_A,
      pid: 4242,
      hasTranscript: true,
    });
    // Both strategies stat the same file at essentially the same instant, so they agree here —
    // merge.test.ts is what proves the "take the fresher one" rule when they disagree.
    expect(session?.lastTranscriptWrite).toStrictEqual(RECENT);
  });
});

describe('DiscoverySessionProvider — rejections from both strategies are summed', () => {
  it('an unrelated rejection from each strategy both appear in the merged result', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await writeFile(path.join(fixture.sessionsDir, 'broken.json'), 'not json {{{', 'utf8');
    await writeUnreadableTranscriptPlaceholder(fixture, 'slug', SESSION_B, RECENT);

    const result = await list();

    expect(result.sessions).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.map((r) => r.file).some((f) => f.endsWith('broken.json'))).toBe(true);
    expect(result.rejected.map((r) => r.file).some((f) => f.includes(SESSION_B))).toBe(true);
  });

  /**
   * Both strategies independently exclude forks via `forks.json` (D-012) — a corrupted file is
   * read, and rejected, by each strategy on its own. This is the concrete case
   * `merge.ts#isSameRejection` exists for: the fixture below would otherwise report "2 entries
   * ignored" for what is really one broken file.
   */
  it('a corrupted forks.json read by both strategies is reported once, not twice', async () => {
    fixture = await createDiscoveryFixture();
    await writeSessionRecord(fixture, '4242', validRecord());
    await writeFile(path.join(fixture.seeyaHome, 'forks.json'), 'not json {{{', 'utf8');

    const result = await list();

    expect(result.sessions).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toMatch(/forks\.json$/);
  });
});
