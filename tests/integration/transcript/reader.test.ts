import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTranscriptFile } from '../../../src/adapters/transcript/reader.js';

/**
 * Integration tests for the streaming transcript parser (S1-T4), against the committed synthetic
 * fixtures docs/TESTES.md § transcript/ requires (large, unknown entry types, truncated last
 * line) plus one more for windowing/exclusion rules. Every fixture is synthetic — see the
 * generator's absence from the repo and AGENTS.md § "Este projeto é de código aberto": no real
 * `.jsonl` content, no real path, no real prompt ever went into `tests/fixtures/transcripts/`.
 */
function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/transcripts/${name}`, import.meta.url));
}

describe('parseTranscriptFile — unknown entry types (docs/TESTES.md mandatory fixture)', () => {
  it('skips and counts unknown types without rejecting them or stopping the read', async () => {
    const result = await parseTranscriptFile(fixturePath('unknown-entry-types.jsonl'));

    expect(result.unknownEntryTypeCount).toBe(2);
    expect(result.rejected).toEqual([]);
    expect(result.facts.lastPrompts).toEqual([
      'Please add input validation to the signup form.',
      'Now also add a rate limiter.',
    ]);
    expect(result.facts.touchedFiles).toEqual([
      '/code/example-project/src/signup-form.ts',
      '/code/example-project/src/rate-limiter.ts',
    ]);
    expect(result.facts.lastActivity).toStrictEqual(new Date('2026-08-16T20:00:05.000Z'));
  });
});

describe('parseTranscriptFile — truncated last line (docs/TESTES.md mandatory fixture)', () => {
  it('rejects only the truncated line, with a reason, and keeps the facts from before it', async () => {
    const result = await parseTranscriptFile(fixturePath('truncated-last-line.jsonl'));

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.file).toMatch(/truncated-last-line\.jsonl:3$/);
    expect(result.rejected[0]?.reason).toMatch(/not valid JSON/i);
    expect(result.unknownEntryTypeCount).toBe(0);
    expect(result.facts.lastPrompts).toEqual(['Refactor the auth module.']);
    expect(result.facts.touchedFiles).toEqual(['/code/example-project/src/auth.ts']);
    // The truncated line never parsed, so lastActivity comes from the last *valid* entry, not
    // an invented "now" and not a crash.
    expect(result.facts.lastActivity).toStrictEqual(new Date('2026-08-16T20:00:07.000Z'));
  });
});

describe('parseTranscriptFile — windowing and exclusion rules', () => {
  it('excludes a sidechain prompt, excludes a Read-tool file, and keeps only the last 10 prompts', async () => {
    const result = await parseTranscriptFile(fixturePath('prompts-and-files.jsonl'));

    expect(result.facts.lastPrompts).toHaveLength(10);
    expect(result.facts.lastPrompts[0]).toBe('Prompt number 3');
    expect(result.facts.lastPrompts.at(-1)).toBe('Prompt number 12');
    expect(result.facts.lastPrompts).not.toContain('Sidechain question from a sub-agent.');
    expect(result.facts.touchedFiles).toEqual(['/code/example-project/notebooks/eda.ipynb']);
    expect(result.facts.lastActivity).toStrictEqual(new Date('2026-08-16T20:00:22.000Z'));
  });
});

describe('parseTranscriptFile — large file (docs/TESTES.md mandatory >1 MB fixture)', () => {
  /**
   * Proof, not assertion, of both claims S1-T4's acceptance criteria makes: (1) the whole file
   * was read — the last prompt window reflects entries at the very end, and `touchedFiles`
   * includes files touched near the very start, 2 MB earlier; (2) it was never held in memory
   * whole — `maxLineBufferBytes` (the pending partial-line buffer's high-water mark) stays near
   * one stream chunk's size, nowhere near the file's total size.
   */
  it('reads the whole file correctly while never buffering more than a small fraction of it', async () => {
    const path = fixturePath('large-session.jsonl');
    const fileSizeBytes = statSync(path).size;
    expect(fileSizeBytes).toBeGreaterThan(1_000_000);

    const result = await parseTranscriptFile(path);

    expect(result.rejected).toEqual([]);
    expect(result.unknownEntryTypeCount).toBe(0);

    // Facts from near the very end of a >2 MB file: proves the read didn't stop early.
    expect(result.facts.lastPrompts).toHaveLength(10);
    expect(result.facts.lastPrompts.at(-1)).toBe('This is the final prompt of the session.');
    expect(result.facts.lastPrompts.at(0)).toBe('Follow-up request 3');
    expect(result.facts.lastActivity).toStrictEqual(new Date('2026-08-16T20:25:42.000Z'));

    // Touched files from both the very start and the very end: proves the whole file was
    // scanned, not just a tail window.
    expect(result.facts.touchedFiles).toEqual([
      '/code/example-project/src/index.ts',
      '/code/example-project/src/health.ts',
      '/code/example-project/src/list.ts',
      '/code/example-project/src/pagination-helpers.ts',
    ]);

    // The actual memory-bound proof: measured, not asserted by comment.
    expect(result.maxLineBufferBytes).toBeLessThan(fileSizeBytes / 10);
  });
});

describe('parseTranscriptFile — edge cases: blank line, out-of-order timestamp, invalid known-type entries, unhandled known type', () => {
  it('handles every edge case in one pass without one interfering with another', async () => {
    const result = await parseTranscriptFile(fixturePath('edge-cases.jsonl'));

    // Three independent rejections (D-022, one per bad line, none aborting the read): a
    // recognized "user" entry missing sessionId, a recognized "assistant" entry missing
    // sessionId, and a well-formed JSON line with no "type" field at all. The blank line and
    // the "mode" line (a known type with nothing to extract) contribute neither a rejection
    // nor an unknown-type count.
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/invalid "user" entry/),
      expect.stringMatching(/invalid "assistant" entry/),
      expect.stringMatching(/missing or invalid "type" field/),
    ]);
    expect(result.unknownEntryTypeCount).toBe(0);

    expect(result.facts.lastPrompts).toEqual(['First edge-case prompt.']);
    expect(result.facts.touchedFiles).toEqual([
      '/code/example-project/edge.ts',
      '/code/example-project/earlier.ts',
    ]);

    // The second assistant entry (earlier.ts) has an EARLIER timestamp than the first
    // (edge.ts) despite coming later in the file — lastActivity must stay at the later one,
    // proving updateLastActivity compares instead of blindly overwriting.
    expect(result.facts.lastActivity).toStrictEqual(new Date('2030-01-01T00:00:20.000Z'));
  });
});

describe('parseTranscriptFile — real I/O failures reject, not swallowed', () => {
  it('rejects when the path does not exist', async () => {
    await expect(parseTranscriptFile(fixturePath('does-not-exist.jsonl'))).rejects.toBeDefined();
  });
});
