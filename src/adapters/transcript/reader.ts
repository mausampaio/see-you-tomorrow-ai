/**
 * Streams a transcript's `.jsonl` content and extracts `SessionFacts`, one line at a time —
 * never the whole file at once (docs/TESTES.md's >1 MB fixture exists to catch exactly that
 * design mistake: holding a multi-megabyte transcript whole just to find its last few prompts).
 * Reuses `adapters/discovery/transcript-cwd.ts`'s `splitLines` for the same chunk-buffer-newline
 * loop that module already solved, but reads to the end of the file instead of stopping at the
 * first match: `touchedFiles` can appear anywhere in the transcript, so there is no early-exit
 * point the way there is for `cwd` (near-certainly on the first line).
 *
 * Per-line outcomes follow D-022: a line with a recognized type (`user`/`assistant`) that fails
 * its schema is a *rejection*, visible with a reason — most often a truncated final line
 * (docs/TESTES.md's other mandatory fixture), which this never lets abort the read. A line whose
 * `type` isn't recognized at all is not a rejection (schemas.ts's docstring: "an unknown type is
 * ignored, not an error") — it's counted separately (`unknownEntryTypeCount`), so version drift
 * stays visible without being confused with an actual defect.
 */
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import type { RejectedDiscoveryRecord } from '../../core/ports.js';
import type { SessionFacts } from '../../core/types.js';
import { splitLines } from '../discovery/transcript-cwd.js';
import {
  KNOWN_ENTRY_TYPE_SET,
  entryTypeSchema,
  userEntryTextSchema,
  assistantEntryToolUseSchema,
} from './schemas.js';
import { MAX_LAST_PROMPTS, extractPromptText, extractTouchedFiles } from './facts.js';

/**
 * `parseTranscriptFile`'s result. `maxLineBufferBytes` is diagnostic only — like
 * `transcript-cwd.ts`'s `bytesRead` — proof, not assertion, that the pending-line buffer never
 * grows anywhere near the file's total size, which is the actual claim "streamed, not loaded
 * whole" makes (docs/TESTES.md's >1 MB fixture, S1-T4's acceptance criteria).
 */
export interface TranscriptParseResult {
  readonly facts: SessionFacts;
  readonly rejected: RejectedDiscoveryRecord[];
  readonly unknownEntryTypeCount: number;
  readonly maxLineBufferBytes: number;
}

interface Accumulator {
  lastActivity: Date | null;
  readonly lastPrompts: string[];
  readonly touchedFiles: Set<string>;
  readonly rejected: RejectedDiscoveryRecord[];
  unknownEntryTypeCount: number;
}

function newAccumulator(): Accumulator {
  return {
    lastActivity: null,
    lastPrompts: [],
    touchedFiles: new Set(),
    rejected: [],
    unknownEntryTypeCount: 0,
  };
}

/** Bounded ring: only the last `MAX_LAST_PROMPTS` survive, so this never grows with file size. */
function pushPrompt(acc: Accumulator, text: string): void {
  acc.lastPrompts.push(text);
  if (acc.lastPrompts.length > MAX_LAST_PROMPTS) {
    acc.lastPrompts.shift();
  }
}

/**
 * Keeps the latest timestamp seen. A plain overwrite would also work on a well-behaved,
 * append-only file, but comparing is what stays correct if that assumption is ever wrong —
 * asserting more ordering than confirmed is the same mistake D-025 forbids for missing data.
 */
function updateLastActivity(acc: Accumulator, timestamp: string): void {
  const candidate = new Date(timestamp);
  if (acc.lastActivity === null || candidate.getTime() > acc.lastActivity.getTime()) {
    acc.lastActivity = candidate;
  }
}

function rejectLine(
  acc: Accumulator,
  filePath: string,
  lineNumber: number,
  raw: unknown,
  reason: string,
): void {
  acc.rejected.push({ file: `${filePath}:${lineNumber}`, raw, reason });
}

function processUserEntry(
  acc: Accumulator,
  filePath: string,
  lineNumber: number,
  parsed: unknown,
): void {
  const result = userEntryTextSchema.safeParse(parsed);
  if (!result.success) {
    const reason = `invalid "user" entry: ${z.prettifyError(result.error)}`;
    rejectLine(acc, filePath, lineNumber, parsed, reason);
    return;
  }
  updateLastActivity(acc, result.data.timestamp);
  const promptText = extractPromptText(result.data);
  if (promptText !== null) {
    pushPrompt(acc, promptText);
  }
}

function processAssistantEntry(
  acc: Accumulator,
  filePath: string,
  lineNumber: number,
  parsed: unknown,
): void {
  const result = assistantEntryToolUseSchema.safeParse(parsed);
  if (!result.success) {
    const reason = `invalid "assistant" entry: ${z.prettifyError(result.error)}`;
    rejectLine(acc, filePath, lineNumber, parsed, reason);
    return;
  }
  updateLastActivity(acc, result.data.timestamp);
  for (const file of extractTouchedFiles(result.data)) {
    acc.touchedFiles.add(file);
  }
}

/**
 * Sniffs `type` on already-parsed JSON and dispatches to the right per-type extractor, or
 * counts/rejects. Assumes `parsed` is valid JSON — `processLine` below is what handles a line
 * that isn't even that.
 */
function dispatchEntry(
  acc: Accumulator,
  filePath: string,
  lineNumber: number,
  parsed: unknown,
): void {
  const typeResult = entryTypeSchema.safeParse(parsed);
  if (!typeResult.success) {
    const reason = `missing or invalid "type" field: ${z.prettifyError(typeResult.error)}`;
    rejectLine(acc, filePath, lineNumber, parsed, reason);
    return;
  }
  const { type } = typeResult.data;
  if (!KNOWN_ENTRY_TYPE_SET.has(type)) {
    acc.unknownEntryTypeCount += 1;
    return;
  }
  if (type === 'user') {
    processUserEntry(acc, filePath, lineNumber, parsed);
  } else if (type === 'assistant') {
    processAssistantEntry(acc, filePath, lineNumber, parsed);
  }
  // Any other known type (queue-operation, mode, ...): recognized, nothing to extract — ignored
  // per docs/ARQUITETURA.md § transcript/ ("Extrai só o que a spec pede").
}

/**
 * One line's worth of work: parse JSON, then dispatch. Never throws — every failure mode a
 * single line can produce (bad JSON, missing `type`, unknown `type`, a known type that fails its
 * schema) is handled here or in `dispatchEntry`, which is what lets a truncated final line
 * (docs/TESTES.md) or a version-drifted entry type never abort the read.
 */
function processLine(acc: Accumulator, filePath: string, lineNumber: number, line: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const reason = `not valid JSON (possibly a truncated write in progress): ${String(error)}`;
    rejectLine(acc, filePath, lineNumber, trimmed, reason);
    return;
  }
  dispatchEntry(acc, filePath, lineNumber, parsed);
}

function toResult(acc: Accumulator, maxLineBufferBytes: number): TranscriptParseResult {
  return {
    facts: {
      lastActivity: acc.lastActivity,
      lastPrompts: [...acc.lastPrompts],
      touchedFiles: [...acc.touchedFiles],
    },
    rejected: acc.rejected,
    unknownEntryTypeCount: acc.unknownEntryTypeCount,
    maxLineBufferBytes,
  };
}

/**
 * Reads `filePath` (explicit `utf8`, never a shell temp-file round-trip — same lesson
 * `transcript-cwd.ts` already learned) end to end and extracts `SessionFacts`. Rejects only on a
 * real stream I/O failure (missing file, permission denied) — the caller
 * (`adapters/transcript/index.ts`) decides what a missing transcript means; this function is only
 * ever given a path already confirmed to exist.
 */
export function parseTranscriptFile(filePath: string): Promise<TranscriptParseResult> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const acc = newAccumulator();
    let buffer = '';
    let lineNumber = 0;
    let maxLineBufferBytes = 0;
    let settled = false;

    function finish(): void {
      if (settled) {
        return;
      }
      settled = true;
      resolve(toResult(acc, maxLineBufferBytes));
    }

    stream.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const combined = buffer + text;
      maxLineBufferBytes = Math.max(maxLineBufferBytes, combined.length);
      const { complete, rest } = splitLines(combined);
      buffer = rest;
      for (const line of complete) {
        lineNumber += 1;
        processLine(acc, filePath, lineNumber, line);
      }
    });

    stream.on('end', () => {
      if (buffer.length > 0) {
        lineNumber += 1;
        processLine(acc, filePath, lineNumber, buffer);
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
