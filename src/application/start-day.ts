/**
 * `seeya start-day`'s steps 4 and 5 (docs/ESPECIFICACAO.md § `seeya start-day`): resume the chosen
 * sessions sequentially — one TTY, one session at a time (docs/spikes/H-retomada-interativa.md,
 * D-015: a process only ever has one terminal to hand over) — and mark each one resumed right
 * after it happens, never before (D-002's "fact, then mark" ordering, applied here to persistence
 * instead of process termination).
 *
 * Which sessions are chosen — the interactive picker, `--all`, `--session <id>` — is decided by
 * `cli/start-day-command.ts`; this module only executes the resume loop for whatever list it's
 * handed, the same separation `application/endDay` already draws between "what's eligible" (its
 * own job) and "how a human is asked" (`cli/`).
 */
import { buildResumePrompt } from '../core/resume-prompt.js';
import type { SessionResumer, Storage } from '../core/ports.js';
import type { Day, Handoff, ResumeOutcome } from '../core/types.js';

export interface StartDayDeps {
  readonly storage: Storage;
  readonly sessionResumer: SessionResumer;
}

export interface ResumeSelectionOptions {
  readonly day: Day;
  /** Already chosen by the caller, in the order they should be resumed. */
  readonly handoffs: readonly Handoff[];
}

export interface ResumeProgressEvent {
  readonly index: number;
  readonly total: number;
  readonly handoff: Handoff;
}

/**
 * Only ever set when the loop stopped early (docs/QUESTOES.md Q-027 item 5, closed for this
 * task): `SessionResumer.resume()` throwing means the fallback ALSO failed fast
 * (`ClaudeSessionResumer`'s own docstring) — the binary or the `cwd` is broken, and retrying the
 * same broken thing for every remaining session would only bury the one error that's actually
 * informative under N repeats of it.
 */
export interface StoppedEarly {
  readonly handoff: Handoff;
  readonly error: Error;
}

export interface ResumeSessionsResult {
  readonly resumed: readonly ResumeOutcome[];
  /** Every handoff never attempted, in original order — includes the one that just failed when
   * `stoppedEarly` is set (it wasn't resumed either). Empty when the loop ran to completion. */
  readonly remaining: readonly Handoff[];
  readonly stoppedEarly: StoppedEarly | false;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

type AttemptOutcome =
  | { readonly ok: true; readonly outcome: ResumeOutcome }
  | { readonly ok: false; readonly error: Error };

/**
 * One session's attempt: resume it, and — only on success, fallback included (a fallback still
 * means the person got a session to work in, per `Storage.saveResumedSessionIds`'s own docstring)
 * — mark it resumed immediately, before moving on to the next session. `resumedSoFar` is mutated
 * in place so the caller's loop can keep passing the same growing set forward without re-reading
 * it from `deps.storage` on every iteration.
 */
async function attemptResume(
  deps: StartDayDeps,
  resumedSoFar: Set<string>,
  day: Day,
  handoff: Handoff,
): Promise<AttemptOutcome> {
  let outcome: ResumeOutcome;
  try {
    outcome = await deps.sessionResumer.resume(
      handoff.sessionId,
      handoff.cwd,
      buildResumePrompt(handoff),
    );
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
  resumedSoFar.add(handoff.sessionId);
  await deps.storage.saveResumedSessionIds(day, resumedSoFar);
  return { ok: true, outcome };
}

/**
 * @example
 * const result = await resumeSessions(deps, { day: '2026-08-16', handoffs: chosen }, (event) =>
 *   console.log(`Resuming ${event.index} of ${event.total}: ${event.handoff.name}`),
 * );
 * // result.stoppedEarly === false means every handoff in `chosen` was attempted.
 */
export async function resumeSessions(
  deps: StartDayDeps,
  options: ResumeSelectionOptions,
  onProgress?: (event: ResumeProgressEvent) => void,
): Promise<ResumeSessionsResult> {
  const resumedSoFar = new Set(await deps.storage.readResumedSessionIds(options.day));
  const resumed: ResumeOutcome[] = [];
  for (const [index, handoff] of options.handoffs.entries()) {
    onProgress?.({ index: index + 1, total: options.handoffs.length, handoff });
    const attempted = await attemptResume(deps, resumedSoFar, options.day, handoff);
    if (!attempted.ok) {
      return {
        resumed,
        remaining: options.handoffs.slice(index),
        stoppedEarly: { handoff, error: attempted.error },
      };
    }
    resumed.push(attempted.outcome);
  }
  return { resumed, remaining: [], stoppedEarly: false };
}
