/**
 * Pure selection logic for `seeya start-day`'s step 3 (docs/ESPECIFICACAO.md § `seeya start-day`:
 * "Pergunta quais sessões retomar (ou `--all`)"). No I/O — `start-day-command.ts` is what reads
 * `--session`/`--all` from `commander` and the actual answer text from the terminal; this module
 * only decides what either one means.
 */
import type { Handoff } from '../core/types.js';

export type SelectionMode =
  | { readonly kind: 'session'; readonly sessionOrCwd: string }
  | { readonly kind: 'all' }
  | { readonly kind: 'interactive' }
  | { readonly kind: 'noTtyNoFlag' };

/**
 * `--session` wins over `--all` when both are given (commander doesn't stop a user from typing
 * both) — an explicit single choice is a narrower, more specific request than "everything".
 * Neither flag and no real terminal to ask in: step 3 ("Pergunta quais sessões retomar") requires
 * a channel to ask through, and there isn't one here — `noTtyNoFlag` routes to an honest "can't
 * ask from here" message instead of a `readline` call that would hang forever waiting on an
 * answer nobody has a way to type.
 */
export function resolveSelectionMode(
  options: { readonly all: boolean; readonly session?: string },
  isTTY: boolean,
): SelectionMode {
  if (options.session !== undefined) {
    return { kind: 'session', sessionOrCwd: options.session };
  }
  if (options.all) {
    return { kind: 'all' };
  }
  if (!isTTY) {
    return { kind: 'noTtyNoFlag' };
  }
  return { kind: 'interactive' };
}

/** `--session <id|cwd>`'s match rule — same "exact string, sessionId or cwd" convention
 * `end-day-command.ts#buildSessionFilter` already uses, applied against every handoff in the
 * found briefing (not just the still-unresumed candidates): an explicit `--session` is allowed to
 * re-target a session already marked resumed, same as `end-day --session` can re-capture one
 * already captured today. */
export function findHandoffBySessionOrCwd(
  handoffs: readonly Handoff[],
  sessionOrCwd: string,
): Handoff | undefined {
  return handoffs.find(
    (handoff) => handoff.sessionId === sessionOrCwd || handoff.cwd === sessionOrCwd,
  );
}

export type ParsedSelection =
  | { readonly kind: 'chosen'; readonly handoffs: readonly Handoff[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly reason: string };

const NONE_ANSWERS = new Set(['', 'none']);

function parseNumberList(raw: string, candidates: readonly Handoff[]): ParsedSelection {
  const indices: number[] = [];
  for (const part of raw
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')) {
    const parsed = Number(part);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > candidates.length) {
      return {
        kind: 'invalid',
        reason:
          `"${part}" is not a valid option (expected a number from 1 to ${candidates.length}, ` +
          '"all", or blank for none)',
      };
    }
    indices.push(parsed - 1);
  }
  const chosen = [...new Set(indices)]
    .sort((a, b) => a - b)
    .map((i) => candidates[i])
    .filter((handoff): handoff is Handoff => handoff !== undefined);
  return { kind: 'chosen', handoffs: chosen };
}

/**
 * Parses one line of free text typed at the interactive picker (`start-day-command.ts`) against
 * `candidates` (already filtered to still-unresumed handoffs, `core/pending-briefing.ts#unresumedHandoffs`).
 * Accepts: blank or "none" (nothing chosen), "all" (every candidate), or a comma-separated list of
 * the 1-based numbers the picker printed next to each candidate. No retry loop on invalid input —
 * v1's minimal choice is to report the problem and treat it as nothing chosen, not to re-prompt.
 *
 * @example
 * parseInteractiveSelection('1,3', candidates) // { kind: 'chosen', handoffs: [candidates[0], candidates[2]] }
 * parseInteractiveSelection('all', candidates) // { kind: 'chosen', handoffs: candidates }
 * parseInteractiveSelection('', candidates)    // { kind: 'none' }
 */
export function parseInteractiveSelection(
  answer: string,
  candidates: readonly Handoff[],
): ParsedSelection {
  const trimmed = answer.trim();
  const normalized = trimmed.toLowerCase();
  if (NONE_ANSWERS.has(normalized)) {
    return { kind: 'none' };
  }
  if (normalized === 'all') {
    return { kind: 'chosen', handoffs: candidates };
  }
  return parseNumberList(trimmed, candidates);
}
