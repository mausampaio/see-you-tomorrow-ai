/**
 * Cheap extraction of `cwd` from a transcript's content. `transcript-lookup.ts` answers "does a
 * transcript exist, and when was it last written" with a `stat`, never opening the file — this
 * module is what the transcript-scan strategy (S1-T8, D-016) needs *after* that: once a `.jsonl`
 * is already inside the `relevanceHours` window (`transcript-scan.ts`'s job, decided from `stat`
 * alone, before this module is ever called), the file's `cwd` still isn't known — the directory
 * slug it lives under is derived from `cwd` but isn't safely reversible (D-016), so the only
 * source of truth is the transcript's own content.
 *
 * Real transcripts pass 1 MB (docs/TESTES.md § transcript/), and `cwd` is a field present on
 * (in practice) every line, so reading the whole file just to find it on line one would trade one
 * waste for another. This reads line by line and stops — destroying the stream — the instant a
 * line yields a usable `cwd`, so a multi-megabyte file with `cwd` on its first line costs one
 * read of ~64 KB (Node's default stream chunk size), not the whole file.
 *
 * A malformed or incomplete line doesn't stop the scan: Claude Code may be writing the transcript
 * at the exact moment `seeya` reads it, and the last line can be a truncated partial write
 * (docs/TESTES.md is explicit that this fixture is mandatory). `JSON.parse` failing on one line
 * only means "not this line" — it's caught here and scanning continues, never thrown to the
 * caller.
 */
import { createReadStream } from 'node:fs';
import { z } from 'zod';

/**
 * Only `cwd` is validated — this is a single-field extraction, not a record schema, and every
 * other field on the line (type, message, timestamps...) is irrelevant here and ignored without
 * complaint, the same tolerant-of-the-rest spirit as D-021 applied to one field instead of a
 * whole object.
 */
const entryWithCwdSchema = z.object({ cwd: z.string().min(1) });

/**
 * Result of `readCwdFromTranscript`. `bytesRead` is diagnostic, not billed anywhere — it exists
 * so a test can assert, by execution, that a large file's read stopped early (docs/TESTES.md's
 * >1 MB fixture) instead of trusting the implementation's word for it. It's an approximate count
 * (chunk string length under `utf8` decoding, not exact on-disk byte count for multi-byte
 * characters) — good enough for "much less than the file size", the only claim it's used for.
 */
export interface CwdLookupResult {
  readonly cwd: string | null;
  readonly bytesRead: number;
}

/**
 * Splits `buffer` on newlines, keeping the trailing partial segment (if any, no closing `\n` yet)
 * as `rest` instead of treating it as a complete line — a line can legitimately span two stream
 * chunks, and judging it broken before the rest of it has arrived would misreport a perfectly
 * fine entry as truncated.
 *
 * Exported: `adapters/transcript`'s streaming fact reader (S1-T4) needs the exact same
 * chunk-to-lines split for the same reason — a `.jsonl` transcript, read as a stream, has no
 * other place a line boundary could legitimately fall — so it reuses this instead of
 * re-implementing it (AGENTS.md "Nada de duplicação").
 */
export function splitLines(buffer: string): { readonly complete: string[]; readonly rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { complete: parts, rest };
}

/** Parses one line as JSON and pulls `cwd` out of it, or `null` for "not this line" — covers both
 * a structurally fine line that just has no `cwd` (most entry types don't) and a broken one
 * (truncated write, garbage). Never throws: `JSON.parse` failing is exactly the truncated-last-line
 * case docs/TESTES.md requires tolerating. */
function cwdFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = entryWithCwdSchema.safeParse(parsed);
  return result.success ? result.data.cwd : null;
}

/**
 * Reads `filePath` (explicit `utf8`, never a shell temp-file round-trip) line by line and returns
 * the first `cwd` found, or `null` if every line was read and none carried one. Stops as soon as
 * `cwd` is found — the stream is destroyed, so nothing past that point is ever read off disk.
 *
 * Rejects only on a real I/O failure (permission denied, the path being a directory, the file
 * disappearing mid-read) — the caller (`transcript-scan.ts`) is responsible for turning that into
 * a visible per-file rejection (D-022), same as every other adapter in this project.
 */
export function readCwdFromTranscript(filePath: string): Promise<CwdLookupResult> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    let buffer = '';
    let bytesRead = 0;
    let settled = false;

    function finish(cwd: string | null): void {
      if (settled) {
        return;
      }
      settled = true;
      stream.destroy();
      resolve({ cwd, bytesRead });
    }

    stream.on('data', (chunk: string | Buffer) => {
      // `createReadStream` is opened with `encoding: 'utf8'` above, so `chunk` is always a
      // string at runtime — the `Buffer` branch only exists to satisfy the generic `data` event
      // type Node exposes for a stream that *could* be in binary mode.
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      bytesRead += text.length;
      const { complete, rest } = splitLines(buffer + text);
      buffer = rest;
      for (const line of complete) {
        const cwd = cwdFromLine(line);
        if (cwd !== null) {
          finish(cwd);
          return;
        }
      }
    });

    // End of file reached with no '\n' after the buffered remainder — still worth a try: it's
    // either the whole (short) file or a truncated final line, and `cwdFromLine` treats both the
    // same way (a value, or null, never a throw).
    stream.on('end', () => finish(cwdFromLine(buffer)));

    stream.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
  });
}
