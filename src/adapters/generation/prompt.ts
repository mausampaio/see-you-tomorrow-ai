/**
 * Builds the text sent to `claude` on stdin (D-015) — the only thing that varies in size between
 * calls, which is exactly why it's the piece D-015 exists to protect: Spike C mutilated this same
 * kind of text by passing it as a command-line argument instead.
 *
 * Pure and synchronous: no I/O, no `Clock` needed (`facts.lastActivity` is already a resolved
 * `Date`, not read here) — easy to unit-test the exact string a given `SessionFacts` produces.
 */
import type { DiscoveredSession, SessionFacts } from '../../core/types.js';

function activityLine(facts: SessionFacts): string | undefined {
  if (facts.lastActivity === null) {
    return undefined;
  }
  return `Last known activity: ${facts.lastActivity.toISOString()}`;
}

function bulletedSection(title: string, items: readonly string[]): string[] {
  if (items.length === 0) {
    return [];
  }
  return [`${title}:`, ...items.map((item) => `- ${item}`)];
}

/**
 * S4-T00c/Q-036: labeled distinctly from `bulletedSection`'s other callers on purpose — this is
 * the one section here that is NOT something the user asked for, and the whole point of adding it
 * (the D-011 reevaluation, docs/DECISOES.md) is the case where the assistant reports work the user
 * never repeats back. A model that read this section as "what the user asked for" would produce
 * exactly the kind of confidently-wrong handoff D-025 forbids, so the title names the speaker
 * explicitly instead of a neutral "Notes" or "Messages".
 */
const ASSISTANT_MESSAGES_TITLE = 'What the assistant said it did (oldest first, its own words)';

/**
 * The lean generator's prompt (D-011): everything `SessionFacts` (S1-T4) knows about the session,
 * laid out as plain labeled text — never JSON, since the model's job here is to read prose and
 * write prose/structured output back, not to round-trip a data structure. `session` supplies the
 * two identity fields `SessionFacts` alone can't (`name`, `cwd`) — see `core/ports.ts#HandoffGenerator`.
 *
 * When nothing at all was found (D-013's "no transcript" case, still routed through the lean
 * generator when some other evidence justified calling it at all), the prompt says so plainly
 * instead of silently reading as "the model just wasn't told about them" (D-025's spirit: absence
 * of evidence is stated, not hidden).
 */
export function buildLeanPrompt(session: DiscoveredSession, facts: SessionFacts): string {
  const lines = [`Project: ${session.name}`, `Working directory: ${session.cwd}`];
  const activity = activityLine(facts);
  if (activity !== undefined) {
    lines.push(activity);
  }
  lines.push(...bulletedSection('Recent user prompts (oldest first)', facts.lastPrompts));
  lines.push(...bulletedSection(ASSISTANT_MESSAGES_TITLE, facts.assistantMessages));
  lines.push(...bulletedSection('Files touched', facts.touchedFiles));
  const nothingFound =
    facts.lastPrompts.length === 0 &&
    facts.assistantMessages.length === 0 &&
    facts.touchedFiles.length === 0;
  if (nothingFound) {
    lines.push('No transcript evidence was available for this session.');
  }
  return lines.join('\n');
}

/**
 * The deep generator's prompt (D-011): a short, fixed instruction, never `SessionFacts` text —
 * `--resume --fork-session` already hands the model the full original conversation, so repeating
 * facts extracted from it would be redundant, not additive. Fixed length, so in principle this
 * could go as a CLI argument under D-015's own rule ("valores curtos e conhecidos") — sent via
 * stdin anyway, so both generators share one invariant ("the prompt is always stdin") instead of
 * two call shapes to reason about.
 */
export const DEEP_GENERATION_PROMPT =
  'Based on the full conversation above, produce the handoff JSON described in the system ' +
  'prompt: what was being worked on, what is left pending, and a short plan for the next ' +
  'session.';
