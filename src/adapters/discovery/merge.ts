/**
 * The fusion step S1-T9 adds on top of D-016's two strategies: turns a
 * `RegistryDiscoveryResult` (S1-T3) and a `TranscriptScanResult` (S1-T8) into the single
 * `DiscoveryResult` `SessionProvider.list()` promises (`core/ports.ts`) — deduplicated by
 * `sessionId`, never the raw concatenation of the two. No I/O here: both inputs are already
 * fully resolved by the strategies that produced them, which is why this lives next to
 * `session-mapping.ts` as a pure, adapter-housed module tested at unit level (docs/TESTES.md)
 * even though it isn't under `core/` — same reasoning as that module's own docstring: it only
 * decides values, it doesn't read anything.
 *
 * D-029 already settled that there is no third origin and no PID-based dedup left to worry about
 * (docs/QUESTOES.md Q-010, "prejudicada"): both remaining origins always carry `sessionId`, so
 * `sessionId` is the only key this module ever groups by.
 */
import type { DiscoveredSession, SessionWithPid, SessionWithoutPid } from '../../core/types.js';
import type { DiscoveryResult, RejectedDiscoveryRecord } from '../../core/ports.js';
import type { RegistryDiscoveryResult, RejectedSessionRecord } from './registry.js';
import type { RejectedTranscriptRecord, TranscriptScanResult } from './transcript-scan.js';

/**
 * The later of two possibly-absent instants, `null` only when both are. Used for every field
 * where "which source is fresher" — not "which source is the registry" — decides the winner
 * (see `fuseSession`'s docstring for why that distinction is the whole point of this function).
 */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Fuses one session discovered by both strategies into a single `SessionWithPid` — the richer
 * shape, since only the registry strategy ever carries `pid`/`procStart`/`processIsAlive`
 * (D-016: the transcript scan structurally cannot produce them, there's no such field on
 * `SessionWithoutPid`). Field-by-field decision, written out because "the registry is richer"
 * is not the same rule for every field:
 *
 * - `pid`, `procStart`, `processIsAlive`, `cwd`, `name`: **always the registry's value.** Not a
 *   contest — the transcript-scan strategy has no `pid`/`procStart`/`processIsAlive` at all, and
 *   its `cwd`/`name` are reconstructed from transcript content (S1-T8) precisely because it has
 *   no better source; the registry's `cwd`/`name` come straight from the record Claude Code
 *   itself wrote (S1-T3, D-021). When both exist, the direct declaration wins over the
 *   reconstruction. (If the two ever disagree about `cwd` for the same `sessionId`, that's a
 *   genuine anomaly, not an expected case this function resolves for you — see docs/QUESTOES.md
 *   Q-012.)
 * - `hasTranscript`, `lastTranscriptWrite`, `lastActivity`: **whichever source has the more
 *   recent or more positive evidence, never whichever source is "the registry".** This is the
 *   PO's explicit call in docs/PLANO-DE-ENTREGA.md S1-T9: the registry's own transcript lookup
 *   (`registry.ts`'s `findTranscript`) and the transcript-scan strategy's own `stat` read the
 *   *same* file, but from two independent calls made at slightly different instants within the
 *   same `list()` invocation — for a session actively being written to right now, that gap can
 *   land on either side of a flush. Picking "the registry's answer" unconditionally would risk
 *   exactly the mistake D-025 already had to correct once (S1-T1): a session that is actually
 *   working read as more idle than it is, because the fact that would have proven otherwise came
 *   from the source this function ignored. Losing a recent-activity signal is worse than losing a
 *   cosmetic field, so freshness — not source identity — decides these three.
 */
function fuseSession(registry: SessionWithPid, scan: SessionWithoutPid): SessionWithPid {
  return {
    ...registry,
    hasTranscript: registry.hasTranscript || scan.hasTranscript,
    lastTranscriptWrite: laterOf(registry.lastTranscriptWrite, scan.lastTranscriptWrite),
    lastActivity: laterOf(registry.lastActivity, scan.lastActivity),
  };
}

/** Merges the registry's accepted sessions with the transcript scan's, fusing every `sessionId`
 * seen in both (`fuseSession`) and passing every `sessionId` seen in only one straight through in
 * that source's own shape — the acceptance's second clause ("sessão presente em uma só entra com
 * a forma daquela origem"). */
function mergeSessions(
  registrySessions: readonly SessionWithPid[],
  scanSessions: readonly SessionWithoutPid[],
): DiscoveredSession[] {
  const scanBySessionId = new Map(scanSessions.map((session) => [session.sessionId, session]));
  const sessions: DiscoveredSession[] = [];

  for (const registrySession of registrySessions) {
    const scanSession = scanBySessionId.get(registrySession.sessionId);
    if (scanSession === undefined) {
      sessions.push(registrySession);
      continue;
    }
    sessions.push(fuseSession(registrySession, scanSession));
    scanBySessionId.delete(registrySession.sessionId);
  }
  sessions.push(...scanBySessionId.values());

  return sessions;
}

/** Two rejections count as "the same underlying problem" when they name the same file for the
 * same reason. In practice this only fires for `forks.json`: both strategies independently call
 * `readForkRegistry` on it (D-012 exclusion, needed by each on its own), so a corrupted
 * `forks.json` produces one rejection from `registry.ts` and one from `transcript-scan.ts` with
 * identical `file`/`reason` — reporting it twice would inflate "N entries ignored" for what is
 * really one broken artifact. `raw` is deliberately excluded from the comparison: both sides
 * parse the same bytes into structurally-equal-but-not-reference-equal values, and `file`+`reason`
 * already identifies "the same external thing failed the same way" without a deep-equality check. */
function isSameRejection(a: RejectedDiscoveryRecord, b: RejectedDiscoveryRecord): boolean {
  return a.file === b.file && a.reason === b.reason;
}

/** Concatenates both strategies' rejections, dropping only exact duplicates (`isSameRejection`) —
 * the acceptance's third clause ("as rejeições das duas aparecem somadas"), with the one carve-out
 * this module's docstring on `isSameRejection` explains. */
function mergeRejected(
  registryRejected: readonly RejectedSessionRecord[],
  scanRejected: readonly RejectedTranscriptRecord[],
): RejectedDiscoveryRecord[] {
  const merged: RejectedDiscoveryRecord[] = [...registryRejected];
  for (const candidate of scanRejected) {
    if (!merged.some((existing) => isSameRejection(existing, candidate))) {
      merged.push(candidate);
    }
  }
  return merged;
}

/**
 * S1-T9's entry point: the deduplicated union `SessionProvider.list()` promises, built from the
 * two strategies' raw results. Neither strategy knows the other exists (their own docstrings say
 * so); this is the one place that does.
 */
export function mergeDiscoveryResults(
  registry: RegistryDiscoveryResult,
  transcriptScan: TranscriptScanResult,
): DiscoveryResult {
  return {
    sessions: mergeSessions(registry.sessions, transcriptScan.sessions),
    rejected: mergeRejected(registry.rejected, transcriptScan.rejected),
  };
}
