/**
 * S1-T7's early-warning detection, wired to the real world: lists `.key` files without a matching
 * `.json` (D-029, `uninspectable-keys.ts`), reads the "already warned" bookkeeping through the
 * injected `Storage` port, runs `core/early-warnings.ts#detectEarlyWarnings` against that listing
 * and the sessions the caller already discovered, and persists the updated bookkeeping — only
 * when something actually changed, so an idle discovery pass never writes to disk for nothing.
 *
 * **Deliberately NOT folded into `DiscoverySessionProvider` (S1-T9, `session-provider.ts`).**
 * That class is already composed by `cli/` (S1-T6, in flight in parallel) with a fixed constructor
 * signature (`claudeHome`, `seeyaHome`, `processControl`, `clock`, `relevanceHours`), and this
 * needs one more dependency (`Storage`) that class doesn't take. A separate function keeps this
 * addition from touching approved, already-wired code and from reaching into `cli/`'s composition
 * — whoever assembles `cli/` calls this right after `SessionProvider.list()`, passing its
 * `sessions` straight through.
 *
 * **Returns plain data, not a `Notice`.** `Notifier`/`Notice` (AGENTS.md glossary) are reserved
 * for S4-T1, which doesn't exist yet — displaying `EarlyWarning`s natively is that task's job, not
 * this one's. This module only detects and remembers; whoever wires S4-T1 in later maps
 * `EarlyWarning.message` onto a real `Notice`.
 */
import type { DiscoveredSession } from '../../core/types.js';
import type { Storage } from '../../core/ports.js';
import { detectEarlyWarnings, type EarlyWarning } from '../../core/early-warnings.js';
import {
  listUninspectableSessionKeys,
  type RejectedUninspectableKeyRecord,
} from './uninspectable-keys.js';

export interface EarlyWarningDiscoveryOptions {
  /** Injectable root standing in for `~/.claude` (never read from `os.homedir()` here). */
  readonly claudeHome: string;
  /** Where the "already warned" bookkeeping (`EarlyWarningState`) is read from and saved to. */
  readonly storage: Storage;
}

export interface EarlyWarningDiscoveryResult {
  readonly earlyWarnings: readonly EarlyWarning[];
  readonly rejected: readonly RejectedUninspectableKeyRecord[];
}

/**
 * `sessions` is whatever `SessionProvider.list()` just returned for this discovery pass (D-016,
 * S1-T9's merged, deduplicated union) — this function doesn't run discovery itself, it only reacts
 * to it. See this module's top comment for why.
 */
export async function discoverEarlyWarnings(
  sessions: readonly DiscoveredSession[],
  options: EarlyWarningDiscoveryOptions,
): Promise<EarlyWarningDiscoveryResult> {
  const [previousState, keysResult] = await Promise.all([
    options.storage.readEarlyWarningState(),
    listUninspectableSessionKeys(options.claudeHome),
  ]);

  const { warnings, nextState } = detectEarlyWarnings(
    sessions,
    keysResult.fileNames,
    previousState,
  );
  if (warnings.length > 0) {
    await options.storage.saveEarlyWarningState(nextState);
  }

  return { earlyWarnings: warnings, rejected: keysResult.rejected };
}
