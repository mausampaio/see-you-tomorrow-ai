import { describe, expect, it } from 'vitest';
import {
  generateUnderstanding,
  selectCaptureMode,
} from '../../../src/application/generation-policy.js';
import { createSessionWithPid } from '../core/_fixtures.js';
import { failingGenerator, succeedingGenerator } from './_fakes.js';

describe('selectCaptureMode (D-011/D-013)', () => {
  it('a session with a transcript and deepCapture: true uses deep', () => {
    const session = createSessionWithPid({ hasTranscript: true });
    expect(selectCaptureMode(session, true)).toBe('deep');
  });

  it('a session with a transcript and deepCapture: false uses lean', () => {
    const session = createSessionWithPid({ hasTranscript: true });
    expect(selectCaptureMode(session, false)).toBe('lean');
  });

  it('a session with NO transcript always uses lean, even with deepCapture: true (D-018 test)', () => {
    const session = createSessionWithPid({ hasTranscript: false });
    expect(selectCaptureMode(session, true)).toBe('lean');
  });
});

describe('generateUnderstanding (D-003)', () => {
  const facts = { lastActivity: null, lastPrompts: [], touchedFiles: [] };

  it('success with a transcript is source: "model"', async () => {
    const session = createSessionWithPid({ hasTranscript: true });
    const generator = succeedingGenerator({
      understanding: 'did X',
      pendingItems: ['finish Y'],
      tomorrowPlan: ['start Z'],
    });
    const outcome = await generateUnderstanding(generator, session, facts);
    expect(outcome).toEqual({
      source: 'model',
      understanding: 'did X',
      pendingItems: ['finish Y'],
      tomorrowPlan: ['start Z'],
      generationError: null,
    });
  });

  it(
    'success with NO transcript is STILL source: "model", not "noTranscript" (Q-021 item 1) — ' +
      '"source" is about who produced the understanding, not what evidence fed it',
    async () => {
      const session = createSessionWithPid({ hasTranscript: false });
      const generator = succeedingGenerator({
        understanding: 'guessed from git alone',
        pendingItems: [],
        tomorrowPlan: [],
      });
      const outcome = await generateUnderstanding(generator, session, facts);
      expect(outcome.source).toBe('model');
      expect(outcome.understanding).toBe('guessed from git alone');
      expect(outcome.generationError).toBeNull();
    },
  );

  it('failure with a transcript falls back to source: "deterministic", facts only (D-003)', async () => {
    const session = createSessionWithPid({ hasTranscript: true });
    const generator = failingGenerator('claude exited with code 1');
    const outcome = await generateUnderstanding(generator, session, facts);
    expect(outcome).toEqual({
      source: 'deterministic',
      understanding: '',
      pendingItems: [],
      tomorrowPlan: [],
      generationError: 'claude exited with code 1',
    });
  });

  it(
    'failure with NO transcript is STILL "deterministic", not "noTranscript" (Q-021 item 1) — ' +
      'the call was attempted and failed, same as any other failed call',
    async () => {
      const session = createSessionWithPid({ hasTranscript: false });
      const generator = failingGenerator('claude exited with code 1');
      const outcome = await generateUnderstanding(generator, session, facts);
      expect(outcome.source).toBe('deterministic');
      expect(outcome.generationError).toBe('claude exited with code 1');
    },
  );

  it('a rejection that is not an Error still gets a non-empty message (String(error))', async () => {
    const session = createSessionWithPid({ hasTranscript: true });
    // Deliberately a non-Error rejection: `generateUnderstanding`'s own contract (defensive,
    // since `HandoffGenerator.generate()` is documented to always reject with an `Error`) covers
    // this on purpose — the lint rule this line disables exists to stop THIS FILE from creating a
    // bad rejection by accident, not to forbid testing how a caller degrades if one arrives anyway.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const generator = { generate: () => Promise.reject('plain string rejection') };
    const outcome = await generateUnderstanding(generator, session, facts);
    expect(outcome.generationError).toBe('plain string rejection');
  });
});
