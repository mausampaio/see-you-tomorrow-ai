/**
 * Discovery adapter: reads `~/.claude/sessions` and `~/.claude/projects`, implements
 * `SessionProvider`. See docs/ARQUITETURA.md.
 *
 * S1-T3, S1-T8 and S1-T10 implement D-016/D-023's three strategies — **registry**
 * (`registry.ts`), **transcript scan** (`transcript-scan.ts`) and **process + `.key`**
 * (`process-key.ts`). `SessionProvider.list()` itself, the deduplicated union of all three
 * strategies, is S1-T9's job: this module doesn't claim to implement the port yet, it only
 * exports each strategy function for whoever wires the merge (S1-T9) or the composition root
 * (`cli/`, S1-T6) to call.
 */
export {
  discoverSessionsFromRegistry,
  type RegistryDiscoveryOptions,
  type RegistryDiscoveryResult,
  type RejectedSessionRecord,
} from './registry.js';
export {
  discoverSessionsFromTranscriptScan,
  type TranscriptScanOptions,
  type TranscriptScanResult,
  type RejectedTranscriptRecord,
} from './transcript-scan.js';
export {
  discoverSessionsFromProcessKey,
  type ProcessKeyOptions,
  type ProcessKeyDiscoveryResult,
  type RejectedProcessKeyRecord,
} from './process-key.js';
