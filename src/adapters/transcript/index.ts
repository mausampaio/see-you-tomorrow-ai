/**
 * Transcript adapter: implements `TranscriptReader` (S1-T4, docs/ARQUITETURA.md § transcript/).
 * `reader.ts` does the actual streaming parse; this module only resolves which file to read and
 * shapes the answer for a session with no transcript at all.
 */
import path from 'node:path';
import type { DiscoveredSession } from '../../core/types.js';
import type { TranscriptReader, TranscriptReadResult } from '../../core/ports.js';
import { locateTranscriptFile } from '../discovery/transcript-lookup.js';
import { parseTranscriptFile } from './reader.js';

/**
 * D-013/D-025: no transcript found is the normal "no evidence" case, not an error — every fact
 * at its least-specific value, never an invented claim about what the session did.
 */
const NO_TRANSCRIPT_RESULT: TranscriptReadResult = {
  facts: { lastActivity: null, lastPrompts: [], assistantMessages: [], touchedFiles: [] },
  rejected: [],
  unknownEntryTypeCount: 0,
};

export interface TranscriptFileReaderOptions {
  /** Injectable root standing in for `~/.claude` (never `os.homedir()` in code of substance) —
   * same convention `adapters/discovery` uses for its own `claudeHome`. */
  readonly claudeHome: string;
}

/**
 * `TranscriptReader` implementation. Given a session, locates its `.jsonl` under
 * `<claudeHome>/projects/` the same way `adapters/discovery` does (`locateTranscriptFile`,
 * shared rather than duplicated) and streams it for facts. A session whose transcript can't be
 * located produces `NO_TRANSCRIPT_RESULT` instead of throwing — `hasTranscript: false` sessions
 * are expected to reach here in practice (the port's caller isn't required to filter them out
 * first), and "not found" is exactly D-013's normal case, not a failure of this adapter.
 */
export class TranscriptFileReader implements TranscriptReader {
  private readonly projectsDir: string;

  constructor(options: TranscriptFileReaderOptions) {
    this.projectsDir = path.join(options.claudeHome, 'projects');
  }

  async readFacts(session: DiscoveredSession): Promise<TranscriptReadResult> {
    const filePath = await locateTranscriptFile(this.projectsDir, session.sessionId);
    if (filePath === null) {
      return NO_TRANSCRIPT_RESULT;
    }
    const parsed = await parseTranscriptFile(filePath);
    return {
      facts: parsed.facts,
      rejected: parsed.rejected,
      unknownEntryTypeCount: parsed.unknownEntryTypeCount,
    };
  }
}
