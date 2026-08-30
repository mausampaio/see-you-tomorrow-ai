/**
 * Plain-text rendering for `seeya sessions` (D-028: CLI output is English; AGENTS.md § "Registro
 * e saída" — user-facing text stays concentrated here, not scattered through the command's
 * orchestration or the discovery adapters).
 */
import type { RejectedDiscoveryRecord } from '../core/ports.js';
import type { SessionRow } from './session-view.js';

/**
 * `lastActivity: null` is absence of data (D-025), never rendered as a real instant. "unknown",
 * not "never" — "never" would claim there was no activity, which nobody can establish from a
 * missing timestamp.
 */
function formatLastActivity(lastActivity: Date | null): string {
  return lastActivity === null ? 'unknown' : lastActivity.toISOString();
}

/**
 * `id:` (S3-T5) is what tells two rows apart when `cwd` (and even the derived display `name`)
 * repeat — the case that motivated this task: the maintainer launches `claude` from the same
 * directory for dozens of sessions in a row, and before this line there was nothing in this
 * listing that distinguished one from another. `row.displaySessionId` is a short, batch-unique
 * prefix (`session-id-display.ts`), not the value `--session` requires — any of its own real
 * prefixes works there too (`cli/session-reference.ts`).
 */
function formatSessionLine(row: SessionRow): string {
  const terminate = row.canTerminate ? 'yes' : 'no';
  return (
    `- ${row.name} (${row.cwd})\n` +
    `    id: ${row.displaySessionId} | state: ${row.state} | ` +
    `last activity: ${formatLastActivity(row.lastActivity)} | terminate on end-day: ${terminate}`
  );
}

/**
 * D-022's "both sides" contract, finally sayable to a human (Q-012): a session count on its own
 * would silently drop every rejection the discovery strategies preserved through the merge.
 */
function formatSummaryLine(sessionCount: number, rejectedCount: number): string {
  const sessions = `${sessionCount} session${sessionCount === 1 ? '' : 's'} found`;
  if (rejectedCount === 0) {
    return `${sessions}.`;
  }
  const entries = `${rejectedCount} entr${rejectedCount === 1 ? 'y' : 'ies'} ignored`;
  return `${sessions}, ${entries}.`;
}

function formatRejectedLine(rejection: RejectedDiscoveryRecord): string {
  return `  - ${rejection.file}: ${rejection.reason}`;
}

export function formatSessionsReport(
  rows: readonly SessionRow[],
  rejected: readonly RejectedDiscoveryRecord[],
): string {
  const lines = [formatSummaryLine(rows.length, rejected.length)];
  if (rows.length > 0) {
    lines.push('', ...rows.map(formatSessionLine));
  }
  if (rejected.length > 0) {
    lines.push('', 'Ignored entries:', ...rejected.map(formatRejectedLine));
  }
  return lines.join('\n');
}
