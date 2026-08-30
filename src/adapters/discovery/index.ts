/**
 * Discovery adapter: reads `~/.claude/sessions` and `~/.claude/projects`, implements
 * `SessionProvider`. See docs/ARQUITETURA.md.
 *
 * S1-T3 and S1-T8 implement D-016's two strategies — **registry** (`registry.ts`) and
 * **transcript scan** (`transcript-scan.ts`). S1-T9 (`merge.ts`, `session-provider.ts`) fuses
 * their results into the single deduplicated `DiscoveryResult` the port promises: `merge.ts` is
 * the pure fusion rule (no I/O, unit-tested), `session-provider.ts` is the `SessionProvider`
 * class `cli/` (the only composition root, D-020) instantiates with concrete `ProcessControl` and
 * `Clock` adapters.
 *
 * **A third strategy — process + `.key` (`process-key.ts`, D-023, S1-T10) — existed here and was
 * removed in S1-T11 (D-029).** The cause D-023 attributed to the sessions it targeted didn't hold
 * up under measurement, and the cost was disproportionate to what was actually observed. See
 * docs/DECISOES.md D-029.
 *
 * **S1-T7 (D-018, D-029) adds early-warning detection** — `uninspectable-keys.ts` (the cheap
 * `.key`-without-`.json` listing D-029 kept from the revoked strategy above) and
 * `early-warnings.ts` (wires that listing plus already-discovered sessions through
 * `core/early-warnings.ts`'s pure rule and the `Storage` port). Neither builds a session; both
 * only feed a warning.
 *
 * **S2-T6 (D-012) adds fork cleanup** — `fork-cleanup.ts`'s `DiscoveryForkCleanup`, the
 * `ForkCleanup` port's implementation. Builds no session either; it deletes a fork's transcript
 * file once `forkCleanupDays` has passed, reusing this adapter's own `fork-registry.ts` reader and
 * `transcript-lookup.ts` file lookup instead of a third copy of either.
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
export { mergeDiscoveryResults } from './merge.js';
export {
  DiscoverySessionProvider,
  type DiscoverySessionProviderOptions,
} from './session-provider.js';
export {
  listUninspectableSessionKeys,
  type UninspectableKeysResult,
  type RejectedUninspectableKeyRecord,
} from './uninspectable-keys.js';
export {
  discoverEarlyWarnings,
  type EarlyWarningDiscoveryOptions,
  type EarlyWarningDiscoveryResult,
} from './early-warnings.js';
export { DiscoveryForkCleanup, type DiscoveryForkCleanupOptions } from './fork-cleanup.js';
