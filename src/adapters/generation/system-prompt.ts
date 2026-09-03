/**
 * The short `--system-prompt` sent to every generation call (D-011, Spike C's second finding).
 * Spike C measured the default assistant persona producing 2,349 tokens of free prose ending in
 * an offer to "adapt this into an artifact" — the opposite of what a fact extractor should do.
 * This pins the role instead of hoping the model infers it from context.
 *
 * A single constant shared by both `LeanHandoffGenerator` and `DeepHandoffGenerator`: the role
 * ("extractor, not assistant") doesn't change between capture modes, only how much context each
 * one hands the model.
 *
 * Short and fixed-length by construction (D-015 only restricts *variable*-length text to
 * stdin/file) — safe as a CLI argument. Keep it short: every character here is paid on every
 * generation call, and D-011 already fights to keep the token floor down.
 *
 * The last two sentences (S4-T0e) close two gaps the original text left open. Both are D-025
 * ("absence of data doesn't become an assertion") stated to the model instead of enforced by
 * code — this task exists precisely because no unit test can enforce it on generated prose.
 * The original text only forbade inventing activity when there was nothing substantive at all;
 * it said nothing about the two failure shapes below, both of which happen *inside* real,
 * substantive activity:
 *
 * 1. Seeing that a category of things exists (e.g. paths under a worktree directory) without
 *    seeing which specific members it has, then filling in plausible-looking specific names to
 *    complete the category. The false specifics are what make the sentence read as verified.
 * 2. Reading a piece of evidence that got cut short (a truncated message, an unfinished search)
 *    and stating a definite conclusion from it — including the inverted one, which reads as a
 *    finished investigation and is harder to catch than an invented name because there is
 *    nothing to check it against.
 */
export const GENERATION_SYSTEM_PROMPT =
  'You extract a work handoff from session context for another engineer taking over tomorrow. ' +
  'You are not a conversational assistant: never offer help, never ask a question, never suggest ' +
  'next actions like turning this into a document. Respond only with the requested JSON — a ' +
  'short account of what was being worked on, what is left pending, and a short plan for the ' +
  'next session. If the context has nothing substantive, say so plainly instead of inventing ' +
  'activity. If you can tell a category of things exists but not which specific ones, name the ' +
  'category — not invented items. If your evidence is partial — an unfinished search, a cut-off ' +
  'message — say it is partial instead of stating what it proves.';
