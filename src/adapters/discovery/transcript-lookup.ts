/**
 * Cheap existence + mtime check for a session's transcript — `stat`, never a read of its
 * content (parsing `.jsonl` is `adapters/transcript`'s job, S1-T4). D-013: a session with no
 * transcript still enters discovery normally, with `hasTranscript: false` — this module exists
 * to answer that question, not to gate on it.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isEnoent } from './fs-errors.js';

export interface TranscriptLookup {
  readonly hasTranscript: boolean;
  readonly lastTranscriptWrite: Date | null;
}

const NOT_FOUND: TranscriptLookup = { hasTranscript: false, lastTranscriptWrite: null };

/** `stat`s one `<slug>/<sessionId>.jsonl` candidate; `null` means "not this slug", not "error". */
async function statTranscriptCandidate(candidate: string): Promise<TranscriptLookup | null> {
  try {
    const stats = await stat(candidate);
    return { hasTranscript: true, lastTranscriptWrite: new Date(stats.mtimeMs) };
  } catch {
    return null;
  }
}

/**
 * Finds `<sessionId>.jsonl` under `projectsDir` (`~/.claude/projects/<slug>/<sessionId>.jsonl`,
 * docs/ESPECIFICACAO.md § "Como as sessões são descobertas"). Per docs/ARQUITETURA.md § `discovery/`,
 * the slug derived from `cwd` is fragile and only an optimization — the correct primary strategy,
 * used here, is to search every project directory for the exact filename, one level deep (no
 * further nesting exists in the real layout).
 *
 * A missing `projectsDir` (no session has ever produced a transcript on this machine) is the
 * normal empty case, not an error. Any other `readdir` failure is left to throw: silently
 * reporting `hasTranscript: false` when the real answer is "couldn't check" would be exactly the
 * kind of unearned claim D-025 forbids — the caller (registry.ts) turns that throw into a visible
 * per-record rejection instead.
 */
export async function findTranscript(
  projectsDir: string,
  sessionId: string,
): Promise<TranscriptLookup> {
  let slugs: string[];
  try {
    slugs = await readdir(projectsDir);
  } catch (error) {
    if (isEnoent(error)) {
      return NOT_FOUND;
    }
    throw error;
  }

  for (const slug of slugs) {
    const candidate = path.join(projectsDir, slug, `${sessionId}.jsonl`);
    const found = await statTranscriptCandidate(candidate);
    if (found !== null) {
      return found;
    }
  }
  return NOT_FOUND;
}
