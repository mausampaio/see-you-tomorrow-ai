/**
 * Discovery adapter: reads `~/.claude/sessions` and `~/.claude/projects`, implements
 * `SessionProvider`. See docs/ARQUITETURA.md.
 *
 * S1-T3 and S1-T8 implement D-016's two strategies — **registry** (`registry.ts`) and
 * **transcript scan** (`transcript-scan.ts`). `SessionProvider.list()` itself, the deduplicated
 * union of both strategies, is S1-T9's job: this module doesn't claim to implement the port yet,
 * it only exports each strategy function for whoever wires the merge (S1-T9) or the composition
 * root (`cli/`, S1-T6) to call.
 *
 * **A third strategy — process + `.key` (`process-key.ts`, D-023, S1-T10) — existed here and was
 * removed in S1-T11 (D-029).** The cause D-023 attributed to the sessions it targeted didn't hold
 * up under measurement, and the cost was disproportionate to what was actually observed. See
 * docs/DECISOES.md D-029.
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
