/**
 * S1-T7's pure detection rule: which sessions/artifacts need a first-time warning, and the
 * updated "already warned" bookkeeping to persist afterward. No I/O here — reading/writing that
 * bookkeeping (`Storage.readEarlyWarningState()`/`saveEarlyWarningState()`, `adapters/storage/`)
 * and listing `.key` files (`adapters/discovery/uninspectable-keys.ts`) both happen outside this
 * module; this only decides, from already-resolved values, what's new.
 *
 * Two triggers, from two different decisions, deliberately worded differently:
 * - **D-018** — a session registered without a transcript. Cause and fix are both known (D-013's
 *   Spike D), so `buildMissingTranscriptWarning` affirms them.
 * - **D-029** — a `.key` file in `~/.claude/sessions/` with no matching `.json`. D-029 is explicit
 *   that the cause here is NOT established — the hypothesis D-023 attributed to it didn't survive
 *   measurement — so `buildUninspectableSessionWarning` states only what's observed and names the
 *   one *lead* on record, never a cause.
 *
 * **Why the `.key` trigger dedupes by file name, not by PID (AGENTS.md: "decide, write the
 * why").** The obvious identifier a `.key` file offers is the PID encoded in its own name, and
 * `sessionId` isn't available at all — that lack is the whole reason D-023's PID-based dedup
 * existed for the (now-revoked) third discovery strategy, and Q-010 already found the problem
 * with it: a PID is not stable across time the way a `sessionId` is, because the OS recycles it.
 * If "already warned" were keyed by PID alone, a stale `.key` left behind by a session that's long
 * gone would permanently suppress the warning for a genuinely new session that later happens to
 * reuse the same PID — silence exactly where a fresh problem appeared. The full file name
 * (`<pid>.<hash>.key`) doesn't have that failure mode: Claude Code mints a new, distinct hash per
 * session (see the historical `process-key.ts`, recovered from commit `e45b348`), so a new session
 * never collides with an old file's name even when the OS recycles its PID. The cost accepted in
 * exchange: a `.key` file that lingers forever (nothing in this project deletes one) keeps being
 * remembered forever too, but that's the same trade-off `notifiedMissingTranscriptSessionIds`
 * already makes for `sessionId` — "once per artifact, forever" is what D-018's "once per session"
 * rule asks for, not "once per day" or "once per machine boot".
 */
import type { DiscoveredSession, EarlyWarningState } from './types.js';

export interface MissingTranscriptWarning {
  readonly kind: 'missingTranscript';
  readonly sessionId: string;
  readonly message: string;
}

export interface UninspectableSessionWarning {
  readonly kind: 'uninspectableSession';
  readonly keyFileName: string;
  readonly message: string;
}

export type EarlyWarning = MissingTranscriptWarning | UninspectableSessionWarning;

/** The bookkeeping a machine with no `~/.seeya/early-warnings.json` yet starts from (D-025:
 * nothing warned about yet is not an error). Exported so `adapters/storage/` and tests don't each
 * reconstruct the same two empty `Set`s. */
export const EMPTY_EARLY_WARNING_STATE: EarlyWarningState = {
  notifiedMissingTranscriptSessionIds: new Set(),
  notifiedUninspectableSessionKeys: new Set(),
};

/**
 * D-018's message: cause and fix are both known. docs/ESPECIFICACAO.md's own table names two
 * indistinguishable causes for the same detectable signal (an inherited child-session marker, or
 * `CLAUDE_CODE_SKIP_PROMPT_HISTORY`) — both are named here instead of picking one, because from
 * outside the session there is no way to tell them apart, and naming only one would read as more
 * certain than the evidence supports (D-025's spirit applied to this message's own wording).
 */
function buildMissingTranscriptWarning(session: DiscoveredSession): MissingTranscriptWarning {
  const message =
    `Session "${session.name}" (${session.cwd}) has no transcript.\n` +
    'Likely cause: an inherited child-session marker, or CLAUDE_CODE_SKIP_PROMPT_HISTORY being ' +
    'set — either one tells Claude Code not to persist a transcript for this session.\n' +
    'Fix: set CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 in the environment of whichever process ' +
    'opens it.\n' +
    "This session's handoff will use git and its worktree as the source instead.";
  return { kind: 'missingTranscript', sessionId: session.sessionId, message };
}

/**
 * D-029's message: the phenomenon is real (seeya can see the file) but the cause is not
 * established — D-023's hypothesis about it didn't survive measurement (see this module's
 * top-of-file comment). States only what's observed, names the one lead on record without
 * claiming it's confirmed, and is explicit about what was and wasn't read — the acceptance
 * criterion this message exists to satisfy is precisely "does not affirm the cause".
 */
function buildUninspectableSessionWarning(keyFileName: string): UninspectableSessionWarning {
  const message =
    `seeya found a session it cannot inspect: "${keyFileName}".\n` +
    'No matching session record and no readable transcript exist for it — only a private ' +
    "session key on disk (mode 600), and seeya never reads its content, only the file's name.\n" +
    'Known lead, not a confirmed cause: sessions started from inside another Claude Code ' +
    'session have produced this pattern before.';
  return { kind: 'uninspectableSession', keyFileName, message };
}

/** The missing-transcript half of `detectEarlyWarnings` — split out because the combined function
 * would otherwise run past AGENTS.md's ~20-line guideline for a second, unrelated reason to change. */
function selectNewMissingTranscriptWarnings(
  sessions: readonly DiscoveredSession[],
  alreadyNotified: ReadonlySet<string>,
): {
  readonly warnings: readonly MissingTranscriptWarning[];
  readonly notified: ReadonlySet<string>;
} {
  const notified = new Set(alreadyNotified);
  const warnings: MissingTranscriptWarning[] = [];
  for (const session of sessions) {
    if (session.hasTranscript || notified.has(session.sessionId)) {
      continue;
    }
    notified.add(session.sessionId);
    warnings.push(buildMissingTranscriptWarning(session));
  }
  return { warnings, notified };
}

/** The `.key`-without-`.json` half of `detectEarlyWarnings`. Mirrors
 * `selectNewMissingTranscriptWarnings` above, one candidate list at a time. */
function selectNewUninspectableWarnings(
  keyFileNames: readonly string[],
  alreadyNotified: ReadonlySet<string>,
): {
  readonly warnings: readonly UninspectableSessionWarning[];
  readonly notified: ReadonlySet<string>;
} {
  const notified = new Set(alreadyNotified);
  const warnings: UninspectableSessionWarning[] = [];
  for (const fileName of keyFileNames) {
    if (notified.has(fileName)) {
      continue;
    }
    notified.add(fileName);
    warnings.push(buildUninspectableSessionWarning(fileName));
  }
  return { warnings, notified };
}

export interface EarlyWarningDetectionResult {
  readonly warnings: readonly EarlyWarning[];
  readonly nextState: EarlyWarningState;
}

/**
 * `sessions` is whatever `SessionProvider.list()` just returned (both discovery strategies
 * already merged, D-016/S1-T9); `uninspectableKeyFileNames` is the bare `.key` file names from the
 * same discovery pass (`adapters/discovery/uninspectable-keys.ts`, D-029) — never file content.
 * `previousState` is what was persisted after the last call.
 *
 * Returns only the *new* warnings (never a growing history — a warning already sent isn't
 * returned again) plus the state to persist next. Whether persisting is worth an I/O round trip
 * when nothing changed is the caller's call, not this function's (see
 * `adapters/discovery/early-warnings.ts`, which skips the write when `warnings` is empty).
 *
 * @example
 * const { warnings, nextState } = detectEarlyWarnings(sessions, keyFileNames, previousState);
 * // warnings: readonly EarlyWarning[] — only what's new since previousState
 */
export function detectEarlyWarnings(
  sessions: readonly DiscoveredSession[],
  uninspectableKeyFileNames: readonly string[],
  previousState: EarlyWarningState,
): EarlyWarningDetectionResult {
  const missingTranscript = selectNewMissingTranscriptWarnings(
    sessions,
    previousState.notifiedMissingTranscriptSessionIds,
  );
  const uninspectable = selectNewUninspectableWarnings(
    uninspectableKeyFileNames,
    previousState.notifiedUninspectableSessionKeys,
  );
  return {
    warnings: [...missingTranscript.warnings, ...uninspectable.warnings],
    nextState: {
      notifiedMissingTranscriptSessionIds: missingTranscript.notified,
      notifiedUninspectableSessionKeys: uninspectable.notified,
    },
  };
}
