/**
 * Every port `scheduler/` orchestrates over time (D-005, S4-T3). Same discipline
 * `application/types.ts#EndDayDeps` already established: every field is a `core/ports.ts`
 * interface, never a concrete adapter (D-020) — `cli/` is the only composition root allowed to
 * name one, and this file is what it builds against.
 *
 * `sessionProvider` is deliberately NOT a field here, unlike `EndDayDeps` — `buildSessionProvider`
 * below is a FACTORY instead, so a fresh `SessionProvider` can be built every poll from
 * freshly-read config. See `buildSessionProvider`'s own docstring for why a daemon that runs for
 * hours can't reuse one built once at startup the way every other, short-lived `seeya` command
 * safely does.
 */
import type {
  Clock,
  ForkCleanup,
  GitReader,
  HandoffGenerator,
  Notifier,
  ProcessControl,
  SessionProvider,
  Storage,
  TranscriptReader,
} from '../core/ports.js';
import type { DiscoveredSession } from '../core/types.js';
import type { EarlyWarning } from '../core/early-warnings.js';

export interface DaemonDeps {
  readonly clock: Clock;
  readonly storage: Storage;
  readonly notifier: Notifier;
  readonly processControl: ProcessControl;
  readonly transcriptReader: TranscriptReader;
  readonly gitReader: GitReader;
  readonly leanGenerator: HandoffGenerator;
  readonly deepGenerator: HandoffGenerator;
  readonly forkCleanup: ForkCleanup;
  /**
   * Runs S1-T7's early-warning detection for real (`adapters/discovery/early-warnings.ts#discoverEarlyWarnings`)
   * against this poll's freshly-discovered `sessions`, returning only what's NEW since last time —
   * that function already persists the updated "already warned" bookkeeping itself, so this
   * callback's only remaining job, from `scheduler/`'s side, is turning each one into a `Notice`
   * (`scheduler/notices.ts#buildEarlyWarningNotice`).
   *
   * A plain callback, not a `core/ports.ts` port: `scheduler/` cannot import `adapters/` at all
   * (docs/ARQUITETURA.md's layer matrix), so `cli/` (D-020) closes over its own `claudeHome`/
   * `Storage` and hands this function down already bound — the same shape of indirection
   * `buildSessionProvider` below uses for the identical reason. Returns bare `EarlyWarning[]`, not
   * the adapter's own `EarlyWarningDiscoveryResult` (which also carries `rejected` — `.key`-listing
   * failures the daemon has no use for and D-022 already lets the underlying discovery pass
   * surface elsewhere): a type importable from `core/early-warnings.ts` is enough for what this
   * layer actually does with it, and avoids this file needing an adapter-shaped type at all.
   */
  readonly discoverEarlyWarnings: (
    sessions: readonly DiscoveredSession[],
  ) => Promise<readonly EarlyWarning[]>;
  /**
   * Builds a fresh `SessionProvider` bound to `relevanceHours`, called once per poll with whatever
   * `storage.readConfig()` just returned (`scheduler/poll.ts`). A one-shot `seeya` command (like
   * `end-day`) gets this for free by being a fresh process every invocation — `cli/composition.ts`
   * reads config once and builds a `SessionProvider` for that one run. The daemon has no such
   * reset: it is ONE process for potentially days, so a `SessionProvider` built once at startup
   * would keep answering with whatever `relevanceHours` was configured when `seeya daemon`
   * launched, silently ignoring a later `seeya config` edit until the daemon itself restarted.
   * Rebuilding is cheap — `DiscoverySessionProvider`'s constructor does no I/O, only `.list()`
   * does — so paying it every 30s poll costs nothing real.
   */
  readonly buildSessionProvider: (relevanceHours: number) => SessionProvider;
}
