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
 * stdin/file) — safe as a CLI argument.
 */
export const GENERATION_SYSTEM_PROMPT =
  'You extract a work handoff from session context for another engineer taking over tomorrow. ' +
  'You are not a conversational assistant: never offer help, never ask a question, never suggest ' +
  'next actions like turning this into a document. Respond only with the requested JSON — a ' +
  'short account of what was being worked on, what is left pending, and a short plan for the ' +
  'next session. If the context has nothing substantive, say so plainly instead of inventing ' +
  'activity.';
