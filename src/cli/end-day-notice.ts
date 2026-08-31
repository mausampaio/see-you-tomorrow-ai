/**
 * Builds the OS notification for `seeya end-day`'s own result (docs/ESPECIFICACAO.md § `seeya
 * end-day`, step 5: "Notifica o resultado e imprime o resumo" — `application/end-day.ts`'s own
 * docstring earmarked this exact step for S4-T1). English (D-028): notification text is public.
 * Concentrated here, not scattered (AGENTS.md § "Texto voltado ao usuário"), same convention
 * `format-end-day.ts` already uses for the terminal report.
 */
import type { EndDayResult } from '../application/types.js';
import type { Notice } from '../core/ports.js';

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Q-007: names the session, the reason, and says the handoff was saved — silence here is exactly
 * the failure Q-007 exists to prevent for whoever turned `canTerminate` on. The underlying
 * `reason` already comes from `application/capture-session.ts#buildTerminationNotice`; this only
 * adds the "handoff was saved" clause Q-007 requires be unmistakable even outside the terminal.
 */
function terminationNoticeLines(result: EndDayResult): string[] {
  return result.terminationNotices.map(
    (notice) =>
      `"${notice.name}" was NOT terminated (${notice.reason}). Its handoff was saved ` +
      'successfully — only the termination did not happen.',
  );
}

function failedCaptureSummary(result: EndDayResult): string | null {
  if (result.failedCaptures.length === 0) {
    return null;
  }
  return (
    `${pluralize(result.failedCaptures.length, 'capture', 'captures')} failed — ` +
    'see the terminal report.'
  );
}

/**
 * `null` for a dry run: `--dry-run` is an explicit preview the person is already watching in the
 * terminal (docs/ESPECIFICACAO.md: "mostra o que faria") — a system notification about a
 * hypothetical outcome would be noise, not the "encerramento executado" event
 * docs/ESPECIFICACAO.md § "Notificações" names.
 */
export function buildEndDayNotice(result: EndDayResult): Notice | null {
  if (result.dryRun) {
    return null;
  }
  const hasIssues = result.failedCaptures.length > 0 || result.terminationNotices.length > 0;
  const title = hasIssues
    ? `seeya end-day: ${result.day} (with issues)`
    : `seeya end-day: ${result.day}`;
  const lines = [`${pluralize(result.captured.length, 'session', 'sessions')} captured.`];
  const failedSummary = failedCaptureSummary(result);
  if (failedSummary !== null) {
    lines.push(failedSummary);
  }
  lines.push(...terminationNoticeLines(result));
  return { title, body: lines.join(' ') };
}
