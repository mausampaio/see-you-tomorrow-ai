/**
 * `seeya start-day [--session <id>] [--all]` (docs/ESPECIFICACAO.md § `seeya start-day`) — the
 * five steps in the spec's own numbering:
 *
 * 1. `findPendingBriefing` (`application/`) — the most recent day whose briefing still has
 *    unresumed, content-pending work (`core/pending-briefing.ts`, D-025).
 * 2. `renderConsolidatedPlan` (`core/`) — printed before any question is asked.
 * 3. Choose which sessions to resume: `--session <id>`, `--all`, or an interactive picker
 *    (`node:readline/promises` — no new dependency). Without either flag and without a real
 *    terminal to ask in, this prints the plan plus the two flags to use instead of hanging on a
 *    question nobody can answer, and exits 0 — an honest "can't ask from here", not an error.
 * 4. `resumeSessions` (`application/start-day.ts`) — sequential, one TTY at a time
 *    (docs/spikes/H-retomada-interativa.md: a process only has one terminal to hand over). This
 *    command prints progress between sessions so whoever comes back to the terminal after one
 *    interactive `claude` session ends knows there's still a queue.
 * 5. Each resumed session is marked resumed by `resumeSessions` itself, right after it happens —
 *    this command never marks anything on its own.
 *
 * If `SessionResumer.resume()` throws (docs/QUESTOES.md Q-027 item 5: only the fallback ALSO
 * failing fast does that), `resumeSessions` already stopped the loop — this command reports what
 * did and didn't happen and exits non-zero, and never retries the remaining sessions itself.
 */
import { createInterface } from 'node:readline/promises';
import {
  findPendingBriefing,
  type PendingBriefingLookup,
} from '../application/find-pending-briefing.js';
import { resumeSessions } from '../application/start-day.js';
import { renderConsolidatedPlan } from '../core/consolidated-plan.js';
import { unresumedHandoffs } from '../core/pending-briefing.js';
import type { Clock, SessionResumer, Storage } from '../core/ports.js';
import type { Day, Handoff } from '../core/types.js';
import {
  findHandoffBySessionReference,
  parseInteractiveSelection,
  resolveSelectionMode,
} from './start-day-selection.js';
import {
  formatInvalidSelection,
  formatNoPendingBriefing,
  formatNoSessionMatch,
  formatNoTtyInstructions,
  formatResumeProgress,
  formatStartDaySummary,
  renderPickerQuestion,
} from './format-start-day.js';

export interface StartDayCommandOptions {
  readonly all: boolean;
  readonly session?: string;
}

/** Injected so this command is testable without a real terminal (`tests/unit/cli/start-day-command.test.ts`
 * drives it with `node:stream`'s `PassThrough`) — `index.ts` passes the real `process.stdin`/
 * `process.stdout`. */
export interface StartDayIo {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly isTTY: boolean;
}

export interface StartDayCommandContext {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly sessionResumer: SessionResumer;
}

type FoundLookup = Extract<PendingBriefingLookup, { found: true }>;

type Selection =
  | { readonly kind: 'chosen'; readonly handoffs: readonly Handoff[] }
  | { readonly kind: 'blocked'; readonly message: string };

async function askInteractively(
  candidates: readonly Handoff[],
  io: StartDayIo,
): Promise<Selection> {
  const rl = createInterface({ input: io.stdin, output: io.stdout });
  let answer: string;
  try {
    // S3-T6: a blank line before the question — without it, this printed right after the plan
    // with no visual break, and the two ran together into one wall of text.
    answer = await rl.question(`\n${renderPickerQuestion(candidates)}`);
  } finally {
    rl.close();
  }
  const parsed = parseInteractiveSelection(answer, candidates);
  if (parsed.kind === 'invalid') {
    return { kind: 'blocked', message: formatInvalidSelection(parsed.reason) };
  }
  return { kind: 'chosen', handoffs: parsed.kind === 'none' ? [] : parsed.handoffs };
}

async function pickSessions(
  lookup: FoundLookup,
  options: StartDayCommandOptions,
  io: StartDayIo,
): Promise<Selection> {
  const candidates = unresumedHandoffs(lookup.briefing, lookup.resumedSessionIds);
  const mode = resolveSelectionMode(options, io.isTTY);
  if (mode.kind === 'session') {
    // S3-T5: 'ambiguous' collapses into the same "no match" message as 'notFound' here — never
    // resumes a guess (D-025) — pending a distinguishable ambiguous message, which belongs in
    // `format-start-day.ts` (S3-T6's file, out of this task's reach; docs/QUESTOES.md Q-030).
    const match = findHandoffBySessionReference(lookup.briefing.handoffs, mode.sessionOrCwd);
    return match.kind === 'found'
      ? { kind: 'chosen', handoffs: [match.item] }
      : { kind: 'blocked', message: formatNoSessionMatch(mode.sessionOrCwd) };
  }
  if (mode.kind === 'all') {
    return { kind: 'chosen', handoffs: candidates };
  }
  if (mode.kind === 'noTtyNoFlag') {
    return { kind: 'blocked', message: formatNoTtyInstructions() };
  }
  return askInteractively(candidates, io);
}

async function resumeAndReport(
  context: StartDayCommandContext,
  day: Day,
  handoffs: readonly Handoff[],
  io: StartDayIo,
): Promise<number> {
  const result = await resumeSessions(
    { storage: context.storage, sessionResumer: context.sessionResumer },
    { day, handoffs },
    (event) => io.stdout.write(`\n${formatResumeProgress(event)}\n`),
  );
  io.stdout.write(`\n${formatStartDaySummary(result)}\n`);
  return result.stoppedEarly === false ? 0 : 1;
}

async function runWithPendingBriefing(
  context: StartDayCommandContext,
  lookup: FoundLookup,
  options: StartDayCommandOptions,
  io: StartDayIo,
): Promise<number> {
  io.stdout.write(
    `${renderConsolidatedPlan(lookup.briefing, lookup.daysAgo, lookup.resumedSessionIds)}\n`,
  );
  const selection = await pickSessions(lookup, options, io);
  if (selection.kind === 'blocked') {
    io.stdout.write(`\n${selection.message}\n`);
    return 0;
  }
  if (selection.handoffs.length === 0) {
    io.stdout.write('\nNothing selected — nothing resumed.\n');
    return 0;
  }
  return resumeAndReport(context, lookup.briefing.day, selection.handoffs, io);
}

export async function runStartDayCommand(
  context: StartDayCommandContext,
  options: StartDayCommandOptions,
  io: StartDayIo,
): Promise<number> {
  const lookup = await findPendingBriefing(context.storage, context.clock);
  if (!lookup.found) {
    io.stdout.write(`${formatNoPendingBriefing(lookup.daysSearched)}\n`);
    return 0;
  }
  return runWithPendingBriefing(context, lookup, options, io);
}
