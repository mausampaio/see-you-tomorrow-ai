/**
 * Pure view-model assembly for `seeya sessions` (docs/ESPECIFICACAO.md § "seeya sessions"). No
 * I/O: `sessions`/`config`/`now` all arrive already resolved by the caller (`sessions-command.ts`)
 * — this module only decides what to show and how to sort it.
 */
import { classifyState } from '../core/classification.js';
import type { DiscoveredSession, SessionState, Config } from '../core/types.js';
import { computeDisplaySessionIds } from './session-id-display.js';
import { projectPolicyFor } from '../application/eligibility-assembly.js';

export interface SessionRow {
  readonly name: string;
  readonly cwd: string;
  /** Full `sessionId` (S3-T5) — `--session` matching (`cli/session-reference.ts`) uses this, not
   * `displaySessionId`, which exists for reading, not for pasting back into another command
   * (though it happens to work there too via prefix matching, since it's always one of that
   * session's own real prefixes). */
  readonly sessionId: string;
  /** A short, batch-unique stand-in for `sessionId` (`session-id-display.ts`) — what tells two
   * sessions apart in `seeya sessions` when their `cwd` (and even their derived `name`) collide,
   * which is exactly the case that motivated S3-T5: the maintainer launches `claude` from the same
   * directory for dozens of sessions in a row. */
  readonly displaySessionId: string;
  readonly state: SessionState;
  /** `null` is absence of data (D-025), never rendered as a real instant by the formatter. */
  readonly lastActivity: Date | null;
  readonly canTerminate: boolean;
}

/**
 * `config.projectPolicy`, matched by NORMALIZED `cwd` (S4-T12, docs/QUESTOES.md Q-056 item 3) —
 * `application/eligibility-assembly.ts#projectPolicyFor` is the single place that normalization
 * lives (same criterion `core/eligibility.ts`'s `ignoredCwds` already uses for `ignore`); `cli/`
 * importing `application/` is permitted (D-020), so this reuses it instead of a second, raw-key
 * lookup that would silently stop matching the moment a `cwd` arrives spelled differently than
 * whatever's on disk (a different separator, case, or a trailing slash — exactly the bug this task
 * fixes). A `cwd` the policy doesn't mention at all defaults to `canTerminate: false` (D-002:
 * termination is opt-in, silence means "not opted in").
 *
 * Exported (S2-T5): `cli/format-end-day.ts` needs the exact same resolution to describe, during a
 * `--dry-run` preview, which captured sessions the config WOULD have terminated — reusing this
 * instead of a second copy (AGENTS.md: "nada de duplicação").
 */
export function resolveCanTerminate(cwd: string, config: Config): boolean {
  return projectPolicyFor(config, cwd).canTerminate;
}

/**
 * Builds one row per discovered session, sorted by name then `cwd` for a stable, readable
 * listing — `SessionProvider.list()` makes no ordering promise, and the alternative (discovery
 * order) would reshuffle the same sessions between two runs for no reason a human could use.
 */
export function buildSessionRows(
  sessions: readonly DiscoveredSession[],
  config: Config,
  now: Date,
): SessionRow[] {
  const displayIds = computeDisplaySessionIds(sessions.map((session) => session.sessionId));
  const rows = sessions.map((session): SessionRow => ({
    name: session.name,
    cwd: session.cwd,
    sessionId: session.sessionId,
    // Falls back to the full id only in the defensive, shouldn't-happen case
    // `computeDisplaySessionIds` itself documents (two identical sessionIds in the same batch).
    displaySessionId: displayIds.get(session.sessionId) ?? session.sessionId,
    state: classifyState(session, { now, idleMinutes: config.idleMinutes }),
    lastActivity: session.lastActivity,
    canTerminate: resolveCanTerminate(session.cwd, config),
  }));
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.cwd.localeCompare(b.cwd));
}
