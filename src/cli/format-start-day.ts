/**
 * Plain-text rendering for `seeya start-day` (D-028: CLI output is English; AGENTS.md § "Registro
 * e saída" — user-facing text stays concentrated here, not scattered through
 * `start-day-command.ts`). Same convention `format-end-day.ts`/`format-sessions.ts` already use.
 */
import { formatResumeNotice } from '../core/resume-notice.js';
import type { Handoff } from '../core/types.js';
import type { ResumeProgressEvent, ResumeSessionsResult } from '../application/start-day.js';

/** Same shape as `format-end-day.ts`/`core/briefing.ts`'s own local helpers — user-facing
 * counts read as English, never as "day(s)". */
function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatNoPendingBriefing(daysSearched: number): string {
  return (
    `No pending briefing found in the last ${pluralize(daysSearched, 'day', 'days')} scanned. ` +
    'Nothing to resume — ' +
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

/**
 * `received` is the `--session` value exactly as this process got it — after whatever the
 * shell already did to it, which this code has no way to undo or even detect on its own
 * (docs/PLANO-DE-ENTREGA.md S3-T5: a maintainer typed a backslash-heavy Windows path in Git
 * Bash, the shell ate the backslashes, and the value that reached `seeya` was silently
 * different from what was typed — with no way for this function, by itself, to tell).
 *
 * **`matchedAgainst` is the seam left for that fix.** S3-T5 owns `start-day-selection.ts` and
 * is adding path normalization there, but it isn't allowed to touch this file (S3-T6 owns it).
 * Once a caller has both the raw value and whatever normalized form it actually compared
 * against handoffs, passing both here shows the reader exactly what was tried — instead of a
 * bare "no match" that hides a mangled value behind a string that still looks plausible. Until
 * a caller has a normalized form to offer, this parameter stays absent (D-025: no fabricated
 * second value), and the message is exactly what it was before.
 */
export function formatNoSessionMatch(received: string, matchedAgainst?: string): string {
  const alsoTried =
    matchedAgainst !== undefined && matchedAgainst !== received
      ? ` (matched against "${matchedAgainst}")`
      : '';
  return `No session in this briefing matches "${received}"${alsoTried} (checked against sessionId and cwd).`;
}

/**
 * Wraps `parseInteractiveSelection`'s `reason` (`start-day-selection.ts`) with the two things it
 * leaves implicit — raised by the maintainer after the first real run. `reason` alone explains
 * only the expected format ("expected a number from 1 to 3, ..."); a reader who just watched a
 * list of sessions scroll by and typed something wrong still doesn't know **what happened as a
 * result**. Confirmed with the maintainer: still no retry loop (S3-T3's "run it again" choice
 * stands) and exit code 0 (same convention as `--session` matching nothing — "did nothing" is
 * one outcome in this command, not a distinct error).
 *
 * The `--help` pointer is here instead of longer syntax help inline: `--all`/`--session` would
 * have let this person skip the picker's question format entirely, and that's a better answer
 * than getting the typed syntax right — but the full explanation of both flags already lives in
 * one place (commander's own `--help`), so it's pointed to rather than duplicated.
 */
export function formatInvalidSelection(reason: string): string {
  return (
    `Invalid answer: ${reason}. Nothing was resumed — run "seeya start-day" again. ` +
    'See "seeya start-day --help" for --all/--session, which skip this question entirely.'
  );
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
