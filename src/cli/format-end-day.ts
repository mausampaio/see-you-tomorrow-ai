/**
 * Plain-text rendering for `seeya end-day` (D-028: CLI output is English; AGENTS.md § "Registro e
 * saída" — user-facing text stays concentrated here, not scattered through `end-day-command.ts` or
 * `application/end-day.ts`). Same convention `format-sessions.ts`/`format-status.ts` already use.
 */
import type { CapturedSession, EndDayResult } from '../application/types.js';
import type { Config, Handoff } from '../core/types.js';
import type { RejectedDiscoveryRecord } from '../core/ports.js';
import { countUnreadableListings, formatSessionListingLine } from '../core/briefing.js';
import { renderItemList } from '../core/consolidated-plan.js';
import { resolveCanTerminate } from './session-view.js';

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatHeader(result: EndDayResult): string {
  const suffix = result.dryRun ? ' (dry run — nothing is written or terminated)' : '';
  return `seeya end-day — ${result.day}${suffix}`;
}

/** S4-T0c: the terminal report states `result.scope` explicitly too, same reasoning and same two
 * cases as `core/briefing.ts#renderScopeNote` — a `--session` run and a full run must be
 * distinguishable by reading either surface, not just the file. S4-T0d: the narrowed case also
 * names how many capture candidates the filter discarded, same arithmetic and same denominator as
 * `core/briefing.ts#renderScopeNote` (`ResolvedEndDayScope.captureCandidateCount`, never
 * `discoveredCount` — see that type's own docstring in `core/types.ts`). */
function formatScopeLine(result: EndDayResult): string {
  if (result.scope.kind === 'fullDay') {
    return 'Scope: full day.';
  }
  const { sessionValue, captureCandidateCount, consideredCount } = result.scope;
  const discardedCount = captureCandidateCount - consideredCount;
  return (
    `Scope: narrowed by --session "${sessionValue}" — ${consideredCount} of ` +
    `${captureCandidateCount} capture candidates considered; ${discardedCount} discarded by the ` +
    'filter.'
  );
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

/** S4-T0h: how much of `understanding` the terminal report shows before pointing at `summary.md`
 * for the rest. Chosen, not measured — there's no "right" screen width, but a captured real run
 * printed a 1682-character `understanding` as one unbroken paragraph per session (the maintainer's
 * screenshot that opened this task), and a two-session report at that size scrolls past anything a
 * terminal shows without paging. ~200 characters is roughly a terminal's own soft-wrap of 2-3
 * lines — long enough to say something, short enough that N sessions still fit on one screen. The
 * full text was never lost: it's already in `summary.md` (`core/briefing.ts#renderTextBlock`), and
 * `docs/PLANO-DE-ENTREGA.md` S4-T0h says plainly that a short excerpt (or nothing) can beat
 * reproducing the wall verbatim. */
const UNDERSTANDING_EXCERPT_CHARS = 200;

/** Prefers cutting at the end of a sentence within budget (reads like a summary, not a stump);
 * falls back to the last word boundary when no sentence end falls late enough in the budget to be
 * worth preferring over just using the whole budget. Never cuts mid-word — a `dev-…` fragment is
 * exactly the "correu até a largura do terminal" wall this task exists to stop, just shorter. */
function excerptUnderstanding(text: string): { excerpt: string; truncated: boolean } {
  if (text.length <= UNDERSTANDING_EXCERPT_CHARS) {
    return { excerpt: text, truncated: false };
  }
  const budget = text.slice(0, UNDERSTANDING_EXCERPT_CHARS);
  const sentenceEnd = Math.max(
    budget.lastIndexOf('. '),
    budget.lastIndexOf('! '),
    budget.lastIndexOf('? '),
  );
  if (sentenceEnd > UNDERSTANDING_EXCERPT_CHARS * 0.4) {
    return { excerpt: budget.slice(0, sentenceEnd + 1), truncated: true };
  }
  const wordEnd = budget.lastIndexOf(' ');
  return { excerpt: wordEnd > 0 ? budget.slice(0, wordEnd) : budget, truncated: true };
}

/** D-025: a failed generation is not silently folded into "worked on the thing" — same distinction
 * `core/briefing.ts#renderDeterministicCallout` already draws for the written briefing. */
function formatUnderstanding(handoff: Handoff): string {
  if (handoff.source === 'deterministic') {
    const reason = handoff.generationError ?? 'no error message was recorded';
    return `    Understanding not available: ${reason}`;
  }
  const text = handoff.understanding.trim();
  if (text === '') {
    return '    Understanding: (nothing recorded)';
  }
  const { excerpt, truncated } = excerptUnderstanding(text);
  // AGENTS.md § "Dados de fora": shortening is fine, but the reader has to know there's more —
  // never a silent cut that reads as the whole thing.
  const suffix = truncated ? ' (…, full text in summary.md)' : '';
  return `    Understanding: ${excerpt}${suffix}`;
}

/** D-025, same discipline `core/consolidated-plan.ts#renderSessionPlanLine` already applies to
 * `start-day`'s plan: a `deterministic`/`noTranscript` handoff never had the model confirm
 * "nothing pending" (D-003) — `formatUnderstanding` above already says the generation failed, and
 * printing an empty pending list next to it would blur "failed" with "checked and clean". Only a
 * `source: "model"` handoff renders a list — or, if it explicitly found nothing, says so plainly
 * instead of leaving silence that could read as an oversight. */
function formatPendingSection(handoff: Handoff): string[] {
  if (handoff.source !== 'model') {
    return [];
  }
  const lines: string[] = [];
  if (handoff.pendingItems.length > 0) {
    lines.push(renderItemList('pending', handoff.pendingItems));
  }
  if (handoff.tomorrowPlan.length > 0) {
    lines.push(renderItemList('plan', handoff.tomorrowPlan));
  }
  return lines.length > 0 ? lines : ['    nothing pending recorded'];
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
    // S4-T0h: the reason this task exists — `pendingItems`/`tomorrowPlan` used to never print
    // here at all, so the person who just ran `end-day` got the narrative and never the short,
    // actionable list that is the actual reason to run the command.
    lines.push(...formatPendingSection(handoff));
  }
  return lines;
}

/** D-031: named separately from `Captured:` on purpose — a listed session was never a capture
 * attempt, so showing it under the same header would misrepresent what happened to it (same
 * "never mixed" rule `application/types.ts#EndDayResult.listedSessions` and
 * `core/briefing.ts#renderListedSessionsSection` already state for the other two surfaces).
 * Per-line rendering and the S4-T0c unreadable-count note reuse `core/briefing.ts`'s own
 * functions rather than a second copy of the same "(no title)" vs. "title unavailable" branching
 * (AGENTS.md § "Estilo de código": "nada de duplicação"). */
function formatListedSessionsSection(result: EndDayResult): string[] {
  if (result.listedSessions.length === 0) {
    return [];
  }
  const unreadableCount = countUnreadableListings(result.listedSessions);
  const unreadableNote =
    unreadableCount > 0
      ? ` (${pluralize(unreadableCount, 'entry', 'entries')} could not be read for title/prompt)`
      : '';
  const lines = ['', `Not captured (closed sessions, D-031)${unreadableNote}:`];
  for (const listing of result.listedSessions) {
    lines.push(formatSessionListingLine(listing));
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
    formatScopeLine(result),
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
