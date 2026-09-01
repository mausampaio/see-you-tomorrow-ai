import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTranscriptListingInfo } from '../../../src/adapters/transcript/listing.js';

/**
 * Integration tests for D-031's listing extraction, against the committed synthetic fixtures
 * (AGENTS.md § "Este projeto é de código aberto" — synthetic content only, no real prompt or path).
 */
function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/transcripts/${name}`, import.meta.url));
}

describe('parseTranscriptListingInfo — ai-title and last-prompt (D-031, Spike I)', () => {
  it('keeps the LATEST occurrence of each, since both are rewritten as the session evolves', async () => {
    const result = await parseTranscriptListingInfo(fixturePath('listing-entries.jsonl'));

    expect(result.aiTitle).toBe('Finish the onboarding flow review');
    expect(result.lastPrompt).toBe('Check the review comments');
  });
});

describe('parseTranscriptListingInfo — absent entries (D-025)', () => {
  it('answers null for either field never found, never an invented title', async () => {
    const result = await parseTranscriptListingInfo(fixturePath('unknown-entry-types.jsonl'));

    expect(result).toStrictEqual({ aiTitle: null, lastPrompt: null });
  });
});

describe('parseTranscriptListingInfo — tolerance for unrelated and malformed lines', () => {
  it('never stops or rejects on a truncated final line, still answering the entries seen so far', async () => {
    // truncated-last-line.jsonl carries no ai-title/last-prompt at all — this proves the
    // truncated JSON on the last line doesn't abort the read (same tolerance as
    // reader.ts#parseTranscriptFile), not that a title was found.
    const result = await parseTranscriptListingInfo(fixturePath('truncated-last-line.jsonl'));

    expect(result).toStrictEqual({ aiTitle: null, lastPrompt: null });
  });
});

describe('parseTranscriptListingInfo — real I/O failures reject, not swallowed', () => {
  it('rejects when the path does not exist', async () => {
    await expect(
      parseTranscriptListingInfo(fixturePath('does-not-exist.jsonl')),
    ).rejects.toBeDefined();
  });
});
