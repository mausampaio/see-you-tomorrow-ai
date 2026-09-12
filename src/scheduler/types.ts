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

/** `Config.captureModel`/`Config.budgetPerSessionUsd` (S4-T12) — the two fields
 * `DaemonDeps.buildGenerators` needs fresh every poll. Named locally, not imported from
 * `adapters/generation/*` (whose `LeanHandoffGeneratorOptions`/`DeepHandoffGeneratorOptions` this
 * happens to be a subset of): `scheduler/` cannot import `adapters/` at all (D-020's layer matrix),
 * and this file already keeps its own small types for the same reason `EarlyWarning` above is
 * imported from `core/` rather than an adapter. */
export interface CaptureGeneratorOptions {
  readonly model: string;
  readonly budgetPerSessionUsd: number;
}

export interface DaemonDeps {
  readonly clock: Clock;
  readonly storage: Storage;
  readonly notifier: Notifier;
  readonly processControl: ProcessControl;
  readonly transcriptReader: TranscriptReader;
  readonly gitReader: GitReader;
  readonly forkCleanup: ForkCleanup;
  /**
   * Runs S1-T7's early-warning detection for real (`adapters/discovery/early-warnings.ts#discoverEarlyWarnings`)
   * against this poll's freshly-discovered `sessions`, returning only what's NEW since last time —
   * that function already persists the updated "already warned" bookkeeping itself, so this
   * callback's only remaining job, from `scheduler/`'s side, is turning the whole batch into ONE
   * `Notice` (`scheduler/notices.ts#buildEarlyWarningsNotice`, S4-T7 Part 2).
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
  /**
   * Builds fresh `lean`/`deep` `HandoffGenerator`s bound to `options`, called once per poll with
   * whatever `storage.readConfig()` just returned (`scheduler/poll.ts#buildEndDayDeps`) — the exact
   * same factory shape `buildSessionProvider` above already uses, and for the identical reason
   * (S4-T12, docs/QUESTOES.md Q-049 item 8): a daemon is ONE process for potentially days, so
   * generators built once at startup would keep using whatever `captureModel`/`budgetPerSessionUsd`
   * `config.json` held when `seeya daemon` launched, silently ignoring a later `seeya config edit`
   * until the daemon itself restarted — exactly the gap `relevanceHours` already avoids via
   * `buildSessionProvider`, now closed for the capture model/budget too. Building two generator
   * instances is cheap (both constructors do no I/O; only `.generate()` spawns `claude -p`), so
   * paying it every 30s poll costs nothing real, the same reasoning `buildSessionProvider`'s own
   * docstring already gives for rebuilding a `SessionProvider`.
   */
  readonly buildGenerators: (options: CaptureGeneratorOptions) => {
    readonly leanGenerator: HandoffGenerator;
    readonly deepGenerator: HandoffGenerator;
  };
}
