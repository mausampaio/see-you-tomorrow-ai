import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { TranscriptFileReader } from '../../../src/adapters/transcript/index.js';
import type { SessionWithoutPid } from '../../../src/core/types.js';

/**
 * Integration tests for `TranscriptFileReader` (the `TranscriptReader` port implementation,
 * S1-T4): path resolution under a fake `~/.claude/projects/` plus the "no transcript found" case
 * (D-013). The actual parsing rules are `reader.test.ts`'s job — this file only proves the
 * plumbing between a `DiscoveredSession` and the right `.jsonl` on disk.
 */
const FIXTURE_SESSION_ID = '11111111-1111-4111-8111-111111111111';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/transcripts/${name}`, import.meta.url));
}

function fakeSession(overrides: Partial<SessionWithoutPid> = {}): SessionWithoutPid {
  return {
    hasPid: false,
    sessionId: FIXTURE_SESSION_ID,
    cwd: '/code/example-project',
    name: 'example-project',
    hasTranscript: true,
    lastTranscriptWrite: null,
    lastActivity: null,
    ...overrides,
  };
}

let claudeHome: string | undefined;

afterEach(async () => {
  if (claudeHome !== undefined) {
    await rm(path.dirname(claudeHome), { recursive: true, force: true });
    claudeHome = undefined;
  }
});

async function createClaudeHomeWithTranscript(fixtureName: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'seeya-transcript-reader-'));
  claudeHome = path.join(root, '.claude');
  const slugDir = path.join(claudeHome, 'projects', 'slug');
  await mkdir(slugDir, { recursive: true });
  await copyFile(fixturePath(fixtureName), path.join(slugDir, `${FIXTURE_SESSION_ID}.jsonl`));
  return claudeHome;
}

describe('TranscriptFileReader.readFacts — locates and reads the right file', () => {
  it('finds the transcript under any slug and returns its facts', async () => {
    const home = await createClaudeHomeWithTranscript('unknown-entry-types.jsonl');
    const reader = new TranscriptFileReader({ claudeHome: home });

    const result = await reader.readFacts(fakeSession());

    expect(result.facts.lastPrompts).toEqual([
      'Please add input validation to the signup form.',
      'Now also add a rate limiter.',
    ]);
    expect(result.unknownEntryTypeCount).toBe(2);
  });
});

describe('TranscriptFileReader.readListingInfo — locates and reads the right file (D-031)', () => {
  it('finds the transcript under any slug and returns its listing entries', async () => {
    const home = await createClaudeHomeWithTranscript('listing-entries.jsonl');
    const reader = new TranscriptFileReader({ claudeHome: home });

    const result = await reader.readListingInfo(fakeSession());

    expect(result).toStrictEqual({
      aiTitle: 'Finish the onboarding flow review',
      lastPrompt: 'Check the review comments',
    });
  });
});

describe('TranscriptFileReader.readListingInfo — no transcript found (D-031/D-025)', () => {
  it('answers { aiTitle: null, lastPrompt: null }, never throwing, when no file matches', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'seeya-transcript-reader-'));
    claudeHome = path.join(root, '.claude');
    await mkdir(path.join(claudeHome, 'projects'), { recursive: true });
    const reader = new TranscriptFileReader({ claudeHome });

    const result = await reader.readListingInfo(fakeSession({ hasTranscript: false }));

    expect(result).toStrictEqual({ aiTitle: null, lastPrompt: null });
  });
});

describe('TranscriptFileReader.readFacts — no transcript found (D-013)', () => {
  it('answers with least-specific facts, never throwing, when projects/ has no matching file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'seeya-transcript-reader-'));
    claudeHome = path.join(root, '.claude');
    await mkdir(path.join(claudeHome, 'projects'), { recursive: true });
    const reader = new TranscriptFileReader({ claudeHome });

    const result = await reader.readFacts(fakeSession({ hasTranscript: false }));

    expect(result).toStrictEqual({
      facts: { lastActivity: null, lastPrompts: [], assistantMessages: [], touchedFiles: [] },
      rejected: [],
      unknownEntryTypeCount: 0,
    });
  });

  it('answers the same way when ~/.claude/projects/ itself does not exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'seeya-transcript-reader-'));
    claudeHome = path.join(root, '.claude');
    const reader = new TranscriptFileReader({ claudeHome });

    const result = await reader.readFacts(fakeSession({ hasTranscript: false }));

    expect(result.facts).toStrictEqual({
      lastActivity: null,
      lastPrompts: [],
      assistantMessages: [],
      touchedFiles: [],
    });
  });
});
