/**
 * Plain-text rendering for `seeya end-day` (D-028: CLI output is English; AGENTS.md § "Registro e
 * saída" — user-facing text stays concentrated here, not scattered through `end-day-command.ts` or
 * `application/end-day.ts`). Same convention `format-sessions.ts`/`format-status.ts` already use.
 */
import type { CapturedSession, EndDayResult } from '../application/types.js';
import type { Config, Handoff } from '../core/types.js';
import type { RejectedDiscoveryRecord } from '../core/ports.js';
import { resolveCanTerminate } from './session-view.js';

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatHeader(result: EndDayResult): string {
  const suffix = result.dryRun ? ' (dry run — nothing is written or terminated)' : '';
  return `seeya end-day — ${result.day}${suffix}`;
}

/** D-031: names how many were kept out of scope right in the summary line — without this, "N in
 * scope" alone leaves no way to tell "everything discovered was in scope" apart from "some
 * sessions were quietly dropped", which is exactly the kind of omission D-022's sibling reasoning
 * (AGENTS.md § "Dados de fora") already rules out for discovery rejections on the same line. */
function formatDiscoverySummary(result: EndDayResult): string {
  const discovered = `${pluralize(result.discoveredCount, 'session', 'sessions')} discovered`;
  const rejected =
    result.rejectedDiscoveries.length > 0
      ? `, ${pluralize(result.rejectedDiscoveries.length, 'entry', 'entries')} ignored`
      : '';
  const listed =
    result.listedSessions.length > 0
      ? `, ${pluralize(result.listedSessions.length, 'session', 'sessions')} not captured (closed)`
      : '';
  return `${discovered}${rejected}; ${result.sessionsInScope} in scope${listed}.`;
}

function formatRejectedDiscoveries(rejected: readonly RejectedDiscoveryRecord[]): string[] {
  if (rejected.length === 0) {
    return [];
  }
  return [
    '',
    'Ignored discovery entries:',
    ...rejected.map((entry) => `  - ${entry.file}: ${entry.reason}`),
  ];
}

/** D-025: a failed generation is not silently folded into "worked on the thing" — same distinction
 * `core/briefing.ts#renderDeterministicCallout` already draws for the written briefing. */
function formatUnderstanding(handoff: Handoff): string {
  if (handoff.source === 'deterministic') {
    const reason = handoff.generationError ?? 'no error message was recorded';
    return `    Understanding not available: ${reason}`;
  }
  const text = handoff.understanding.trim();
  return `    Understanding: ${text === '' ? '(nothing recorded)' : text}`;
}

/**
 * `wouldTerminate`/`terminated` describe two different things on purpose. A dry run never actually
 * calls `terminateGracefully` (`capture-session.ts`'s own dry-run short-circuit), so `terminated`
 * is always `false` there and would be misleading to print as-is; `wouldTerminate` is computed
 * straight from the same policy + session-state signal the real run would have used
 * (`sessionState !== "unknown"` is exactly `SessionWithPid`'s territory — D-024's discriminated
 * union means only that shape is ever a termination candidate).
 */
function formatTerminationLabel(
  captured: CapturedSession,
  result: EndDayResult,
  config: Config,
): string {
  if (!result.dryRun) {
    return `terminated: ${captured.terminated ? 'yes' : 'no'}`;
  }
  const wouldTerminate =
    resolveCanTerminate(captured.handoff.cwd, config) &&
    captured.handoff.sessionState !== 'unknown';
  return `would terminate: ${wouldTerminate ? 'yes' : 'no'}`;
}

function formatCapturedSection(result: EndDayResult, config: Config): string[] {
  if (result.captured.length === 0) {
    return [];
  }
  const lines = ['', 'Captured:'];
  for (const captured of result.captured) {
    const { handoff } = captured;
    lines.push(`- ${handoff.name} (${handoff.cwd})`);
    lines.push(
      `    mode: ${handoff.captureMode} | source: ${handoff.source} | ` +
        formatTerminationLabel(captured, result, config),
    );
    lines.push(formatUnderstanding(handoff));
  }
  return lines;
}

/** D-031: named separately from `Captured:` on purpose — a listed session was never a capture
 * attempt, so showing it under the same header would misrepresent what happened to it (same
 * "never mixed" rule `application/types.ts#EndDayResult.listedSessions` and
 * `core/briefing.ts#renderListedSessionsSection` already state for the other two surfaces). D-025:
 * an absent `aiTitle` prints as an explicit "(no title)", never a made-up one. */
function formatListedSessionsSection(result: EndDayResult): string[] {
  if (result.listedSessions.length === 0) {
    return [];
  }
  const lines = ['', 'Not captured (closed sessions, D-031):'];
  for (const listing of result.listedSessions) {
    const title = listing.aiTitle ?? '(no title)';
    const prompt = listing.lastPrompt === null ? '' : ` — last prompt: "${listing.lastPrompt}"`;
    lines.push(`- ${listing.name} (${listing.cwd}): "${title}"${prompt}`);
  }
  return lines;
}

function formatIneligibleSection(result: EndDayResult): string[] {
  if (result.ineligible.length === 0) {
    return [];
  }
  const lines = ['', 'Ineligible:'];
  for (const item of result.ineligible) {
    lines.push(`- ${item.name} (${item.cwd}): ${item.reasons.join(', ')}`);
  }
  return lines;
}

function formatFailedCapturesSection(result: EndDayResult): string[] {
  if (result.failedCaptures.length === 0) {
    return [];
  }
  const lines = ['', 'Failed captures:'];
  for (const item of result.failedCaptures) {
    lines.push(`- ${item.name} (${item.cwd}): ${item.reason}`);
  }
  return lines;
}

/** Q-007: named here too, not just carried in the result — silence is exactly the failure mode
 * Q-007 exists to prevent for whoever set `canTerminate: true`. */
function formatTerminationNoticesSection(result: EndDayResult): string[] {
  if (result.terminationNotices.length === 0) {
    return [];
  }
  const lines = ['', 'Termination notices:'];
  for (const item of result.terminationNotices) {
    lines.push(`- ${item.name} (${item.cwd}): ${item.reason}`);
  }
  return lines;
}

/** Counts each `ForkCleanupOutcome` kind (`core/ports.ts`) for a one-line summary — the per-fork
 * detail isn't actionable to a reader the way the session-level sections above are. */
function summarizeForkOutcomes(result: NonNullable<EndDayResult['forkCleanup']>): string {
  const deleted = result.outcomes.filter((outcome) => outcome.outcome === 'deleted').length;
  const alreadyAbsent = result.outcomes.filter(
    (outcome) => outcome.outcome === 'alreadyAbsent',
  ).length;
  const failed = result.outcomes.filter((outcome) => outcome.outcome === 'failed').length;
  const parts = [
    deleted > 0 ? `${pluralize(deleted, 'fork', 'forks')} deleted` : null,
    alreadyAbsent > 0 ? `${pluralize(alreadyAbsent, 'entry', 'entries')} already absent` : null,
    failed > 0 ? `${pluralize(failed, 'fork', 'forks')} failed to delete` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'nothing to clean up';
}

/**
 * D-012's cleanup, reported honestly for all four states `EndDayResult` can carry: skipped by
 * `--dry-run` (never a preview — see `application/end-day.ts#runForkCleanup`'s own docstring for
 * why), failed outright, ran with nothing to do, or ran and did something.
 */
function formatForkCleanupSection(result: EndDayResult): string[] {
  if (result.dryRun) {
    return ['', 'Fork cleanup: skipped (a dry run never deletes files, D-012).'];
  }
  if (result.forkCleanupError !== null) {
    return ['', `Fork cleanup: failed — ${result.forkCleanupError}`];
  }
  if (result.forkCleanup === null) {
    // Should not happen outside the two cases above — kept explicit rather than silently omitted
    // (D-025: absence of a report is not the same as "nothing happened").
    return ['', 'Fork cleanup: did not run.'];
  }
  const lines = ['', `Fork cleanup: ${summarizeForkOutcomes(result.forkCleanup)}.`];
  if (result.forkCleanup.rejected.length > 0) {
    lines.push(
      `  ${pluralize(result.forkCleanup.rejected.length, 'entry', 'entries')} in forks.json ignored.`,
    );
  }
  return lines;
}

/**
 * The one section whose content differs by KIND, not just by count, between a dry run and a real
 * one: a dry run shows the full markdown that would have been written (docs/TESTES.md's e2e nº2:
 * "descreve o que faria"), a real run only confirms the write happened — the content itself is
 * already on disk at `~/.seeya/days/<day>/summary.md` for anyone who wants to read it.
 */
function formatBriefingSection(result: EndDayResult): string[] {
  if (result.dryRun) {
    return ['', 'Briefing preview (not written):', '', result.briefingPreview ?? ''];
  }
  return [
    '',
    `Wrote ${pluralize(result.captured.length, 'handoff', 'handoffs')} and the daily briefing (summary.md).`,
  ];
}

export function formatEndDayReport(result: EndDayResult, config: Config): string {
  const lines = [
    formatHeader(result),
    formatDiscoverySummary(result),
    ...formatRejectedDiscoveries(result.rejectedDiscoveries),
    ...formatCapturedSection(result, config),
    ...formatListedSessionsSection(result),
    ...formatIneligibleSection(result),
    ...formatFailedCapturesSection(result),
    ...formatTerminationNoticesSection(result),
    ...formatForkCleanupSection(result),
    ...formatBriefingSection(result),
  ];
  return lines.join('\n');
}
