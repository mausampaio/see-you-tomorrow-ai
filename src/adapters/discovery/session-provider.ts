/**
 * The `SessionProvider` port's implementation (S1-T9): runs both discovery strategies (S1-T3's
 * registry, S1-T8's transcript scan) and hands their results to `merge.ts`. This is the module
 * `cli/` (the only composition root, D-020) instantiates: it takes `ProcessControl` and `Clock`
 * by constructor — both ports, never a concrete adapter named here — the same pattern
 * `registry.ts` and `transcript-scan.ts` already use for their own options.
 */
import type { Clock, DiscoveryResult, ProcessControl, SessionProvider } from '../../core/ports.js';
import { discoverSessionsFromRegistry } from './registry.js';
import { discoverSessionsFromTranscriptScan } from './transcript-scan.js';
import { mergeDiscoveryResults } from './merge.js';

export interface DiscoverySessionProviderOptions {
  /** Injectable root standing in for `~/.claude` (never read from `os.homedir()`). */
  readonly claudeHome: string;
  /** Injectable root standing in for `~/.seeya`, only used to find `forks.json` (D-012). */
  readonly seeyaHome: string;
  readonly processControl: ProcessControl;
  /** The project's single source of "now" (D-019) — read once per `list()` call, never cached
   * across calls, so two calls in the same process see two independent `relevanceHours` windows. */
  readonly clock: Clock;
  /** `relevanceHours` from `config.json` (default 12h, docs/ARQUITETURA.md § Config), forwarded
   * to the transcript-scan strategy unchanged. */
  readonly relevanceHours: number;
}

/**
 * `SessionProvider`'s concrete implementation (D-016, S1-T9). `list()` runs both strategies
 * concurrently and returns the already-merged, deduplicated `DiscoveryResult` — callers never see
 * the two sources or need to deduplicate on their own (`core/ports.ts`'s contract for this port).
 */
export class DiscoverySessionProvider implements SessionProvider {
  constructor(private readonly options: DiscoverySessionProviderOptions) {}

  async list(): Promise<DiscoveryResult> {
    const { claudeHome, seeyaHome, processControl, clock, relevanceHours } = this.options;
    const [registryResult, transcriptScanResult] = await Promise.all([
      discoverSessionsFromRegistry({ claudeHome, seeyaHome, processControl }),
      discoverSessionsFromTranscriptScan({
        claudeHome,
        seeyaHome,
        now: clock.now(),
        relevanceHours,
      }),
    ]);
    return mergeDiscoveryResults(registryResult, transcriptScanResult);
  }
}
