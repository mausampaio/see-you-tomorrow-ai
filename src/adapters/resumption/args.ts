/**
 * Argument arrays for `adapters/resumption` (S3-T2). Every value here is a fixed flag, a short
 * known value (a session UUID, a file path this module itself created), or — only below the
 * measured threshold — the prompt text itself as a positional argument.
 *
 * **The positional prompt is D-015 as corrected, not an exception to it.** Spike H measured that
 * `spawn(bin, [...args, text], { shell: false })` round-trips a multiline/quoted/accented string
 * byte-for-byte: what mangled Spike C's text was the shell re-interpreting it, never the argument
 * slot itself. D-015 now reads "no shell reachable, and small enough" — this file is where "small
 * enough" is decided and enforced, once, so nothing downstream has to re-derive it.
 */

/**
 * Ceiling for the prompt as a positional argument, in UTF-16 code units — the same unit
 * `String.prototype.length` counts in, and the same unit Windows' `CreateProcess` counts its
 * ~32,767-unit command-line ceiling in (Spike H). Set to roughly 1/8 of that ceiling: headroom for
 * `--resume <36-char-uuid>` and the binary path, for any character that needs a surrogate pair
 * (rare in the plain text these plans are written in, but not impossible), and for whatever the
 * OS's own argv quoting adds on top of the raw text. A plan long enough to hit this is already an
 * edge case D-004 didn't anticipate — `tomorrowPlan` is documented as a short list, not a
 * document — which is why exceeding it routes to the fallback (`resumer.ts`) instead of trying
 * the argument anyway and finding out by failing.
 */
export const RESUME_PROMPT_ARG_LIMIT_CHARS = 4096;

/** `claude --resume <sessionId> "<prompt>"` — no `-p`: plain interactive mode is what makes the
 * spawned process attach to the inherited terminal instead of degrading into a single
 * non-interactive reply (Spike H). */
export function buildResumeArgs(sessionId: string, prompt: string): string[] {
  return ['--resume', sessionId, prompt];
}

/** Fixed, short, English (AGENTS.md § "Idioma": CLI-facing text) — safe as an argument regardless
 * of prompt size, because it never varies. Gives the fallback session an actual first turn instead
 * of opening on a blank prompt the user has to know to fill in themselves. */
export const FALLBACK_KICKOFF_PROMPT =
  "Continue from yesterday's plan (see the note added to this session's context).";

/** The fallback never resumes (D-004's "sessão nova"): the plan travels via
 * `--append-system-prompt-file`, a file path — a short, known-length argument regardless of how
 * long the file's own content is (D-015) — pointing at the file `resumer.ts` wrote through
 * `context-file.ts`. */
export function buildFallbackArgs(contextFilePath: string): string[] {
  return ['--append-system-prompt-file', contextFilePath, FALLBACK_KICKOFF_PROMPT];
}
