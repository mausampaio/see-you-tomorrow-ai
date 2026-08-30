/**
 * Renders `seeya start-day`'s step 2, "Mostra o plano consolidado" (docs/ESPECIFICACAO.md §
 * `seeya start-day`) — a short, plain overview of every session in the pending `Briefing`
 * (`core/ports.ts`, S3-T1) that a human reads right before step 3 ("Pergunta quais sessões
 * retomar"). Pure text, no I/O (`core/` never does I/O) — `cli/` (S3-T3) is what actually prints
 * it and drives the picker; this module only decides what the text says.
 *
 * **Deliberately not `core/briefing.ts#generateBriefingMarkdown` reused wholesale.** That
 * renderer is `seeya end-day`'s own output format (S2-T4) — full git facts, recall blocks, an
 * "Unreadable entries" section — sized for a saved document read once, days later. Here the
 * reader is about to be asked "which of these do you want to resume", so only the field that
 * answers that question belongs: what's pending, not everything the day recorded.
 * `core/briefing.ts`'s "no false affirmation" discipline (D-025) still applies at this shorter
 * length — see `renderSessionPlanLine` below.
 */
import { handoffStillPending } from './pending-briefing.js';
import type { Briefing } from './ports.js';
import type { Handoff } from './types.js';

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** D-025: a `source !== "model"` handoff never had its pending status actually evaluated — this
 * says so plainly instead of printing an empty "Pending: " that would read as "confirmed clean". */
function renderSessionPlanLine(handoff: Handoff): string {
  const header = `- ${handoff.name} (\`${handoff.cwd}\`)`;
  if (handoff.source !== 'model') {
    return `${header}\n    status unknown — the automated capture produced no analysis (source: ${handoff.source})`;
  }
  if (!handoffStillPending(handoff)) {
    return `${header}\n    nothing pending recorded`;
  }
  const lines = [
    handoff.pendingItems.length > 0 ? `pending: ${handoff.pendingItems.join('; ')}` : '',
    handoff.tomorrowPlan.length > 0 ? `plan: ${handoff.tomorrowPlan.join('; ')}` : '',
  ].filter((line) => line !== '');
  return [header, ...lines.map((line) => `    ${line}`)].join('\n');
}

/**
 * @example
 * renderConsolidatedPlan({ day: '2026-08-16', handoffs: [h1, h2], rejected: [] })
 * // "Plan for 2026-08-16 (2 sessions)\n\n- ...\n- ..."
 */
export function renderConsolidatedPlan(briefing: Briefing): string {
  const title = `Plan for ${briefing.day} (${pluralize(briefing.handoffs.length, 'session', 'sessions')})`;
  if (briefing.handoffs.length === 0) {
    // D-022/D-025: `readBriefing` only ever returns a `Briefing` with zero handoffs when
    // `rejected` is non-empty (otherwise it returns `null`, S3-T1) — so this state is always
    // "every handoff on file for the day was unreadable", never a silent "nothing happened".
    return `${title}\n\nNo readable session found for that day (${pluralize(briefing.rejected.length, 'entry', 'entries')} could not be read).`;
  }
  return [title, '', ...briefing.handoffs.map(renderSessionPlanLine)].join('\n');
}
