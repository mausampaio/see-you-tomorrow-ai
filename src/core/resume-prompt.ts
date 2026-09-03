/**
 * Builds the resume prompt text `seeya start-day`'s step 4 injects as the first message when it
 * runs `claude --resume <sessionId>` (D-004: "injetando o plano do dia anterior como primeiro
 * prompt"). One `Handoff` in, one string out — pure formatting, no I/O, no `Date.now()` (D-019) —
 * so it's testable with plain `Handoff` fixtures, same as `core/briefing.ts`.
 *
 * **Two absences this module refuses to paper over — English, D-028, because this text is sent
 * straight to the model, not read from `docs/`:**
 *
 * - `source !== "model"` — the model never produced `understanding`/`pendingItems`/
 *   `tomorrowPlan` for this handoff (`application/generation-policy.ts` leaves all three at their
 *   empty default on failure or skip). Rendering those empty fields as "nothing was happening,
 *   nothing is pending" would be D-025's exact mistake, aimed at the one reader — the resumed
 *   session itself — least able to catch it from context. Instead this prompt says plainly that
 *   the automated capture produced no analysis and hands over only the raw facts that were
 *   actually recorded (`renderFactsOnlyBody`).
 * - `capturedDuringActiveTurn: true` — the snapshot may already be stale by the time it's read
 *   back (docs/ESPECIFICACAO.md § "Comportamento do daemon": captured mid-turn, up to 5 minutes
 *   of retry already exhausted). Surfaced as its own sentence, not folded into the rest, so the
 *   resumed session knows to re-check reality before trusting the rest of the prompt outright.
 */
import { renderGitBlock } from './briefing.js';
import type { Briefing } from './ports.js';
import type { Handoff } from './types.js';

function renderActiveTurnCaveat(handoff: Handoff): string {
  if (!handoff.capturedDuringActiveTurn) {
    return '';
  }
  return (
    'Note: this handoff was captured while you were still mid-turn, so it may be incomplete ' +
    'or slightly out of date — re-check the current state before relying on it.'
  );
}

function renderListOrNone(items: readonly string[], noneText: string): string {
  return items.length === 0 ? noneText : items.map((item) => `- ${item}`).join('\n');
}

/** `source: "model"` path: the understanding layer actually ran (D-003), so its own words are
 * the prompt's main content. */
function renderModelBody(handoff: Handoff): string {
  const understanding = handoff.understanding.trim() || '_Nothing recorded._';
  const pending = renderListOrNone(
    handoff.pendingItems,
    'Nothing was left pending, as far as the previous capture could tell.',
  );
  const plan = renderListOrNone(handoff.tomorrowPlan, 'No plan was recorded for today.');
  return [
    `What you were doing:\n${understanding}`,
    `Pending items:\n${pending}`,
    `Plan for today:\n${plan}`,
  ].join('\n\n');
}

/** Why the model was never asked, in one sentence — the two `HandoffSource` values this function
 * is ever called for (`core/types.ts#HandoffSource`'s docstring). */
function renderSkippedReason(handoff: Handoff): string {
  if (handoff.source === 'deterministic') {
    const detail = handoff.generationError ?? 'no error message was recorded';
    return `the model call failed during capture (${detail})`;
  }
  return 'there was no transcript to analyze';
}

/** `source !== "model"` path (D-025): no understanding was ever produced, so this hands over only
 * the raw facts a `HandoffFacts` object actually carries, framed honestly as unanalyzed. */
function renderFactsOnlyBody(handoff: Handoff): string {
  const facts = handoff.facts;
  const factLines = [
    `- Last activity: ${facts.lastActivity ? facts.lastActivity.toISOString() : 'unknown'}`,
    `- Recently touched files: ${facts.touchedFiles.length > 0 ? facts.touchedFiles.join(', ') : 'none recorded'}`,
    facts.lastPrompts.length > 0 ? `- Last prompts you sent: ${facts.lastPrompts.join(' / ')}` : '',
  ].filter((line) => line !== '');
  return [
    `The previous automated capture could not produce a summary for this session: ` +
      `${renderSkippedReason(handoff)}.`,
    'Only these raw facts were recorded — there is no analysis of what was being done or what ' +
      'is left; reconstruct that from the facts below and the current state of the repository ' +
      'before assuming anything is finished (D-025: absence of analysis is not evidence of' +
      ' completion).',
    factLines.join('\n'),
    renderGitBlock(facts.git, facts.filesOutsideRepository, facts.reposNotVisited),
  ].join('\n\n');
}

/**
 * @example
 * const prompt = buildResumePrompt(handoff);
 * // prompt is the exact text passed as claude --resume <handoff.sessionId>'s first message.
 */
export function buildResumePrompt(handoff: Handoff): string {
  const header =
    `Resuming session "${handoff.name}" in \`${handoff.cwd}\`, captured ` +
    `${handoff.capturedAt.toISOString()} (state: ${handoff.sessionState}).`;
  const caveat = renderActiveTurnCaveat(handoff);
  const body = handoff.source === 'model' ? renderModelBody(handoff) : renderFactsOnlyBody(handoff);
  return [header, caveat, body].filter((section) => section !== '').join('\n\n');
}

/** One resume prompt per session — what `seeya start-day`'s step 4 needs to call
 * `claude --resume <sessionId>` in `cwd` with `prompt` as the first message (D-004). */
export interface ResumePrompt {
  readonly sessionId: string;
  readonly cwd: string;
  readonly prompt: string;
}

/**
 * One `ResumePrompt` per handoff in `briefing`, in the same order `Storage.readBriefing`
 * returned them. Building the prompt is all this does — **choosing which sessions actually get
 * resumed (step 3, the interactive picker or `--all`) belongs to `seeya start-day`'s CLI (S3-T3),
 * not here.**
 *
 * @example
 * const prompts = buildResumePrompts(lookup.briefing);
 * const chosen = prompts.filter((p) => selectedSessionIds.has(p.sessionId));
 */
export function buildResumePrompts(briefing: Briefing): readonly ResumePrompt[] {
  return briefing.handoffs.map((handoff) => ({
    sessionId: handoff.sessionId,
    cwd: handoff.cwd,
    prompt: buildResumePrompt(handoff),
  }));
}
