/**
 * D-031's listing extraction: streams a transcript's `.jsonl` looking only for the two entries
 * Claude Code already writes for its own "away summary" UI (Spike I) — `ai-title` and
 * `last-prompt` — and keeps the LATEST occurrence of each, since Spike I measured both are
 * rewritten repeatedly as the session evolves ("regravada conforme a sessão evolui"). Unlike
 * `adapters/discovery/transcript-cwd.ts#readCwdFromTranscript`, this never early-exits: the newest
 * occurrence can be anywhere in the file (append-only), so every line has to be seen before the
 * answer is known.
 *
 * Reuses `splitLines` (`transcript-cwd.ts`) for the same chunk-buffer-newline loop
 * `reader.ts#parseTranscriptFile` already solved, and the same tolerant, never-throws-on-a-bad-line
 * shape: a malformed or unrecognized line just isn't this entry, never a reason to stop reading —
 * the same truncated-final-line concern docs/TESTES.md's mandatory fixture exists for. Only a real
 * stream I/O failure rejects.
 */
import { createReadStream } from 'node:fs';
import type { TranscriptListingInfo } from '../../core/ports.js';
import { splitLines } from '../discovery/transcript-cwd.js';
import { entryTypeSchema, aiTitleEntrySchema, lastPromptEntrySchema } from './schemas.js';

interface Accumulator {
  aiTitle: string | null;
  lastPrompt: string | null;
}

/** One line's worth of work: parse JSON, sniff `type`, and overwrite the matching field when it's
 * a recognized listing entry — "not this line" (bad JSON, unrelated type, a listing type whose
 * payload fails its own schema) is never a reason to stop, only a reason to move on. */
function processLine(acc: Accumulator, line: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  const typeResult = entryTypeSchema.safeParse(parsed);
  if (!typeResult.success) {
    return;
  }
  if (typeResult.data.type === 'ai-title') {
    const result = aiTitleEntrySchema.safeParse(parsed);
    if (result.success) {
      acc.aiTitle = result.data.aiTitle;
    }
    return;
  }
  if (typeResult.data.type === 'last-prompt') {
    const result = lastPromptEntrySchema.safeParse(parsed);
    if (result.success) {
      acc.lastPrompt = result.data.lastPrompt;
    }
  }
}

/**
 * Reads `filePath` (explicit `utf8`, never a shell temp-file round-trip — same lesson
 * `transcript-cwd.ts` already learned) end to end and returns the latest `ai-title`/`last-prompt`
 * found, or `null` for either one the file never carried (D-025). Rejects only on a real stream
 * I/O failure (missing file, permission denied) — same contract as `reader.ts#parseTranscriptFile`
 * and `transcript-cwd.ts#readCwdFromTranscript`.
 */
export function parseTranscriptListingInfo(filePath: string): Promise<TranscriptListingInfo> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const acc: Accumulator = { aiTitle: null, lastPrompt: null };
    let buffer = '';
    let settled = false;

    function finish(): void {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ aiTitle: acc.aiTitle, lastPrompt: acc.lastPrompt });
    }

    stream.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const { complete, rest } = splitLines(buffer + text);
      buffer = rest;
      for (const line of complete) {
        processLine(acc, line);
      }
    });

    stream.on('end', () => {
      if (buffer.length > 0) {
        processLine(acc, buffer);
      }
      finish();
    });

    stream.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
  });
}
