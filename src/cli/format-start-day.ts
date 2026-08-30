/**
 * Plain-text rendering for `seeya start-day` (D-028: CLI output is English; AGENTS.md § "Registro
 * e saída" — user-facing text stays concentrated here, not scattered through
 * `start-day-command.ts`). Same convention `format-end-day.ts`/`format-sessions.ts` already use.
 */
import { formatResumeNotice } from '../core/resume-notice.js';
import type { Handoff } from '../core/types.js';
import type { ResumeProgressEvent, ResumeSessionsResult } from '../application/start-day.js';

export function formatNoPendingBriefing(daysSearched: number): string {
  return (
    `No pending briefing found in the last ${daysSearched} day(s) scanned. Nothing to resume — ` +
    'either nothing has been captured yet ("seeya end-day"), or everything already resumed.'
  );
}

export function formatNoTtyInstructions(): string {
  return (
    'Not running in an interactive terminal, so seeya cannot ask which sessions to resume.\n' +
    'Use "seeya start-day --all" to resume every session above, or ' +
    '"seeya start-day --session <id>" to resume just one.'
  );
}

export function formatNoSessionMatch(sessionOrCwd: string): string {
  return `No session in this briefing matches "${sessionOrCwd}" (checked against sessionId and cwd).`;
}

export function renderPickerQuestion(candidates: readonly Handoff[]): string {
  const lines = candidates.map(
    (handoff, index) => `  ${index + 1}) ${handoff.name} (${handoff.cwd})`,
  );
  return [
    'Which sessions do you want to resume?',
    ...lines,
    'Enter comma-separated numbers, "all", or leave blank for none: ',
  ].join('\n');
}

export function formatResumeProgress(event: ResumeProgressEvent): string {
  return `Resuming ${event.index} of ${event.total}: ${event.handoff.name} (${event.handoff.cwd})...`;
}

function formatResumedSection(resumed: ResumeSessionsResult['resumed']): string {
  if (resumed.length === 0) {
    return '';
  }
  const lines = ['Resumed:'];
  for (const outcome of resumed) {
    lines.push(`- ${outcome.sessionId} (${outcome.cwd})`);
    const notice = formatResumeNotice(outcome);
    if (notice !== null) {
      lines.push(`    ${notice}`);
    }
  }
  return lines.join('\n');
}

/** Q-027 item 5, applied to reporting: a stopped loop names both what broke AND, in the same
 * section, exactly which sessions never got a chance — never silently folded into "done". */
function formatRemainingSection(result: ResumeSessionsResult): string {
  const header =
    result.stoppedEarly === false
      ? 'Not resumed:'
      : `Not resumed — stopped after "${result.stoppedEarly.handoff.name}" ` +
        `(${result.stoppedEarly.handoff.cwd}) failed: ${result.stoppedEarly.error.message}`;
  const lines = [
    header,
    ...result.remaining.map((handoff) => `- ${handoff.name} (${handoff.cwd})`),
  ];
  return lines.join('\n');
}

export function formatStartDaySummary(result: ResumeSessionsResult): string {
  const sections = [formatResumedSection(result.resumed)];
  if (result.remaining.length > 0) {
    sections.push(formatRemainingSection(result));
  }
  return sections.filter((section) => section !== '').join('\n\n');
}
