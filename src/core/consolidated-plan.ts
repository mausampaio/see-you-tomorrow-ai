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
 *
 * **`daysAgo` (docs/QUESTOES.md Q-026, revised on review).** `application/find-pending-briefing.ts`
 * no longer refuses an old pending briefing — the age is information for the human, not a
 * cutoff this code applies on their behalf. When the found day isn't yesterday (`daysAgo !== 1`),
 * the title says so plainly ("3 weeks ago") instead of presenting a two-week-old plan as if it
 * were fresh.
 *
 * **`resumedSessionIds` (S3-T3).** A handoff already marked resumed for this day
 * (`Storage.readResumedSessionIds`, `core/pending-briefing.ts`) is called out as such instead of
 * being shown with its (possibly still non-empty) `pendingItems`/`tomorrowPlan` as if nobody had
 * looked at it yet — the same "don't affirm past what's known" discipline this module already
 * applies to a non-`model` handoff, aimed here at a session whose real status has moved on since
 * capture.
 */
import { handoffStillPending } from './pending-briefing.js';
import type { Briefing } from './ports.js';
import type { Handoff } from './types.js';

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * A human-readable age for a day that's `daysAgo` local calendar days in the past. Not called for
 * `daysAgo === 1` today (`renderConsolidatedPlan` treats "yesterday" as the unremarkable, expected
 * case and says nothing extra) — but total over every non-negative input, in case a future caller
 * wants it directly.
 *
 * @example
 * renderRelativeAge(0)  // "today"
 * renderRelativeAge(21) // "3 weeks ago"
 */
export function renderRelativeAge(daysAgo: number): string {
  if (daysAgo === 0) {
    return 'today';
  }
  if (daysAgo === 1) {
    return 'yesterday';
  }
  if (daysAgo < 7) {
    return `${daysAgo} days ago`;
  }
  const weeks = Math.round(daysAgo / 7);
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
}

/** S3-T6: `pendingItems`/`tomorrowPlan` are lists, and the first real terminal read of this
 * output showed why that matters — `join('; ')` turned five items into one run-on line nobody
 * could parse at a glance. One item per line, indented under its own `label:` line, the same
 * shape `renderPickerQuestion` already uses for its own numbered list.
 *
 * **Exported for `cli/format-end-day.ts` to reuse as-is (S4-T0h).** `seeya end-day` hit the exact
 * same bug this function was written to fix — `pendingItems`/`tomorrowPlan` never printed at all
 * there, and the captured-session block had no per-line list to fall back on. A second copy of
 * this same six-line function in `cli/` would be the duplication AGENTS.md § "Estilo de código"
 * rules out (same reuse precedent as `core/briefing.ts#formatSessionListingLine`, cited on its own
 * docstring); this stays in `core/` because it's still pure text shaping with no I/O, not a `cli/`
 * responsibility being pulled upward. */
export function renderItemList(label: string, items: readonly string[]): string {
  return [`    ${label}:`, ...items.map((item) => `      - ${item}`)].join('\n');
}

/** D-025: a `source !== "model"` handoff never had its pending status actually evaluated — this
 * says so plainly instead of printing an empty "Pending: " that would read as "confirmed clean".
 * A handoff already resumed (S3-T3) is called out first, before either of those checks: once
 * resumed, whether the model ever ran or what it reported stops being the interesting fact.
 *
 * **No markdown (S3-T6).** This text is read by a human in a terminal, never rendered — a `cwd`
 * wrapped in backticks the way `core/briefing.ts` (a markdown file writer) would do it shows up
 * as two literal backtick characters on screen. Plain parentheses instead, same as
 * `format-start-day.ts` already uses for every other `name (cwd)` pair. */
function renderSessionPlanLine(handoff: Handoff, resumedSessionIds: ReadonlySet<string>): string {
  const header = `- ${handoff.name} (${handoff.cwd})`;
  if (resumedSessionIds.has(handoff.sessionId)) {
    return `${header}\n    already resumed today`;
  }
  if (handoff.source !== 'model') {
    return `${header}\n    status unknown — the automated capture produced no analysis (source: ${handoff.source})`;
  }
  if (!handoffStillPending(handoff, resumedSessionIds)) {
    return `${header}\n    nothing pending recorded`;
  }
  const blocks = [
    handoff.pendingItems.length > 0 ? renderItemList('pending', handoff.pendingItems) : '',
    handoff.tomorrowPlan.length > 0 ? renderItemList('plan', handoff.tomorrowPlan) : '',
  ].filter((block) => block !== '');
  return [header, ...blocks].join('\n');
}

/** Q-026: yesterday is the ordinary case and gets no extra note; anything else (including today,
 * captured earlier the same day) is called out so nobody mistakes an old plan for a fresh one. */
function renderTitle(briefing: Briefing, daysAgo: number): string {
  const count = `(${pluralize(briefing.handoffs.length, 'session', 'sessions')})`;
  const age = daysAgo === 1 ? '' : ` — ${renderRelativeAge(daysAgo)}`;
  return `Plan for ${briefing.day} ${count}${age}`;
}

/**
 * @example
 * renderConsolidatedPlan({ day: '2026-08-16', handoffs: [h1, h2], rejected: [] }, 1, new Set())
 * // "Plan for 2026-08-16 (2 sessions)\n\n- ...\n- ..."
 * renderConsolidatedPlan({ day: '2026-07-26', handoffs: [h1], rejected: [] }, 21, new Set())
 * // "Plan for 2026-07-26 (1 session) — 3 weeks ago\n\n- ..."
 */
export function renderConsolidatedPlan(
  briefing: Briefing,
  daysAgo: number,
  resumedSessionIds: ReadonlySet<string> = new Set(),
): string {
  const title = renderTitle(briefing, daysAgo);
  if (briefing.handoffs.length === 0) {
    // D-022/D-025: `readBriefing` only ever returns a `Briefing` with zero handoffs when
    // `rejected` is non-empty (otherwise it returns `null`, S3-T1) — so this state is always
    // "every handoff on file for the day was unreadable", never a silent "nothing happened".
    return `${title}\n\nNo readable session found for that day (${pluralize(briefing.rejected.length, 'entry', 'entries')} could not be read).`;
  }
  const lines = briefing.handoffs.map((handoff) =>
    renderSessionPlanLine(handoff, resumedSessionIds),
  );
  return [title, '', ...lines].join('\n');
}
