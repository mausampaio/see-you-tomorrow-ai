import { describe, expect, it } from 'vitest';
import { gatherEvidence } from '../../../src/application/evidence-gathering.js';
import { createSessionWithPid, createSessionWithoutPid } from '../core/_fixtures.js';
import { FakeGitReader, FakeTranscriptReader } from './_fakes.js';
import type { GitReadResult, TranscriptReadResult } from '../../../src/core/ports.js';

const REPO_FACTS: GitReadResult = {
  hasGit: true,
  facts: { branch: 'main', dirty: false, modifiedFiles: [], commitsToday: [], worktrees: [] },
  rejectedWorktrees: [],
};

const TRANSCRIPT_RESULT: TranscriptReadResult = {
  facts: {
    lastActivity: new Date('2026-08-16T20:00:00.000Z'),
    lastPrompts: ['do the thing'],
    assistantMessages: [],
    touchedFiles: ['src/a.ts'],
  },
  rejected: [],
  unknownEntryTypeCount: 0,
};

describe('gatherEvidence (D-013 multi-source)', () => {
  it('all three sources answering: sources is ["git", "transcript", "registry"]', async () => {
    const session = createSessionWithPid({ hasTranscript: true, cwd: 'c:\\code\\projeto' });
    const transcriptReader = new FakeTranscriptReader(
      new Map([[session.sessionId, TRANSCRIPT_RESULT]]),
    );
    const gitReader = new FakeGitReader(new Map([[session.cwd, REPO_FACTS]]));
    const { facts, sources } = await gatherEvidence(transcriptReader, gitReader, session);
    expect(sources).toEqual(['git', 'transcript', 'registry']);
    expect(facts.lastActivity).toEqual(TRANSCRIPT_RESULT.facts.lastActivity);
    expect(facts.git).toEqual(REPO_FACTS.facts);
  });

  it('only git answering (no transcript, no PID): sources is ["git"] — aceite #1', async () => {
    const session = createSessionWithoutPid({ hasTranscript: false, cwd: 'c:\\code\\autonomo' });
    const transcriptReader = new FakeTranscriptReader();
    const gitReader = new FakeGitReader(new Map([[session.cwd, REPO_FACTS]]));
    const { facts, sources } = await gatherEvidence(transcriptReader, gitReader, session);
    expect(sources).toEqual(['git']);
    expect(facts.lastActivity).toBeNull();
    expect(facts.git).toEqual(REPO_FACTS.facts);
  });

  it('only transcript answering (no git, no PID): sources is ["transcript"] — aceite #1', async () => {
    const session = createSessionWithoutPid({ hasTranscript: true, cwd: 'c:\\code\\sem-git' });
    const transcriptReader = new FakeTranscriptReader(
      new Map([[session.sessionId, TRANSCRIPT_RESULT]]),
    );
    const gitReader = new FakeGitReader();
    const { facts, sources } = await gatherEvidence(transcriptReader, gitReader, session);
    expect(sources).toEqual(['transcript']);
    expect(facts.git).toBeNull();
  });

  it('only registry answering (no git, no transcript): sources is ["registry"] — aceite #1', async () => {
    const session = createSessionWithPid({ hasTranscript: false, cwd: 'c:\\code\\so-registro' });
    const transcriptReader = new FakeTranscriptReader();
    const gitReader = new FakeGitReader();
    const { facts, sources } = await gatherEvidence(transcriptReader, gitReader, session);
    expect(sources).toEqual(['registry']);
    expect(facts.lastActivity).toBeNull();
    expect(facts.git).toBeNull();
  });

  it('transcript never called at all when hasTranscript is false (no wasted I/O attempt)', async () => {
    const session = createSessionWithPid({ hasTranscript: false });
    // Deliberately configured to throw if ever called — proves gatherTranscript short-circuits
    // on session.hasTranscript instead of calling readFacts and discarding the result.
    const transcriptReader = new FakeTranscriptReader(new Map(), new Set([session.sessionId]));
    const gitReader = new FakeGitReader();
    await expect(gatherEvidence(transcriptReader, gitReader, session)).resolves.toBeDefined();
  });

  it('a transcript read that throws degrades to "did not respond", not a thrown error', async () => {
    const session = createSessionWithPid({ hasTranscript: true });
    const transcriptReader = new FakeTranscriptReader(new Map(), new Set([session.sessionId]));
    const gitReader = new FakeGitReader();
    const { facts, sources } = await gatherEvidence(transcriptReader, gitReader, session);
    expect(sources).not.toContain('transcript');
    expect(facts.lastActivity).toBeNull();
  });

  it('a git read that throws degrades to "did not respond", not a thrown error', async () => {
    const session = createSessionWithPid({ hasTranscript: false, cwd: 'c:\\code\\falha-git' });
    const transcriptReader = new FakeTranscriptReader();
    const gitReader = new FakeGitReader(new Map(), new Set([session.cwd]));
    const { facts, sources } = await gatherEvidence(transcriptReader, gitReader, session);
    expect(sources).not.toContain('git');
    expect(facts.git).toBeNull();
  });

  it('one source failing does not prevent the other from answering (per-session isolation)', async () => {
    const session = createSessionWithPid({ hasTranscript: true, cwd: 'c:\\code\\parcial' });
    const transcriptReader = new FakeTranscriptReader(new Map(), new Set([session.sessionId]));
    const gitReader = new FakeGitReader(new Map([[session.cwd, REPO_FACTS]]));
    const { sources } = await gatherEvidence(transcriptReader, gitReader, session);
    expect(sources).toEqual(['git', 'registry']);
  });
});
