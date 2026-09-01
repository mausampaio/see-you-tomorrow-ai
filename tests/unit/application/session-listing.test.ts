import { describe, expect, it } from 'vitest';
import { buildSessionListings } from '../../../src/application/session-listing.js';
import { createSessionWithoutPid } from '../core/_fixtures.js';
import { FakeTranscriptReader } from './_fakes.js';

describe('buildSessionListings — one entry per out-of-scope session (D-031)', () => {
  it('carries identity from the session and title/prompt from the transcript reader', async () => {
    const session = createSessionWithoutPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\fechada',
      name: 'fechada-01',
    });
    const transcriptReader = new FakeTranscriptReader(
      new Map(),
      new Set(),
      new Map([
        [session.sessionId, { aiTitle: 'Refactor the parser', lastPrompt: 'run the tests' }],
      ]),
    );

    const listings = await buildSessionListings(transcriptReader, [session]);

    expect(listings).toEqual([
      {
        sessionId: session.sessionId,
        cwd: session.cwd,
        name: session.name,
        aiTitle: 'Refactor the parser',
        lastPrompt: 'run the tests',
      },
    ]);
  });

  it('answers an empty array for an empty input, without calling the reader at all', async () => {
    const listings = await buildSessionListings(new FakeTranscriptReader(), []);
    expect(listings).toEqual([]);
  });

  it('D-025: a session whose transcript never carried either entry lists with both fields null', async () => {
    const session = createSessionWithoutPid();
    const listings = await buildSessionListings(new FakeTranscriptReader(), [session]);
    expect(listings).toEqual([
      {
        sessionId: session.sessionId,
        cwd: session.cwd,
        name: session.name,
        aiTitle: null,
        lastPrompt: null,
      },
    ]);
  });

  it(
    'a readListingInfo failure for one session degrades to "no title" instead of aborting the ' +
      'whole batch — a listing is informational, never load-bearing',
    async () => {
      const good = createSessionWithoutPid({
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: 'c:\\code\\boa',
        name: 'boa',
      });
      const bad = createSessionWithoutPid({
        sessionId: '22222222-2222-4222-8222-222222222222',
        cwd: 'c:\\code\\ruim',
        name: 'ruim',
      });
      const transcriptReader = new FakeTranscriptReader(
        new Map(),
        new Set(),
        new Map([[good.sessionId, { aiTitle: 'Good title', lastPrompt: 'good prompt' }]]),
        new Set([bad.sessionId]),
      );

      const listings = await buildSessionListings(transcriptReader, [good, bad]);

      expect(listings).toEqual([
        {
          sessionId: good.sessionId,
          cwd: good.cwd,
          name: good.name,
          aiTitle: 'Good title',
          lastPrompt: 'good prompt',
        },
        { sessionId: bad.sessionId, cwd: bad.cwd, name: bad.name, aiTitle: null, lastPrompt: null },
      ]);
    },
  );
});
