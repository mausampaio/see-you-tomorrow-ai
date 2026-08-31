/**
 * `SessionResumer`'s only implementation (S3-T2, D-004). Ties together this directory's other
 * modules: `args.ts` decides the argument shape and the size ceiling, `env.ts` sanitizes per
 * D-017, `spawn-interactive.ts` is the one place a real process gets spawned, and
 * `context-file.ts` is the fallback's scratch file. This file's own job is the branching: which of
 * the two attempts runs, and what `ResumeFallbackReason` (if any) the caller sees.
 */
import type { SessionResumer } from '../../core/ports.js';
import type { ResumeFallbackReason, ResumeOutcome } from '../../core/types.js';
import {
  buildFallbackArgs,
  buildResumeArgs,
  describeFallbackAttempt,
  describeResumeAttempt,
  RESUME_PROMPT_ARG_LIMIT_CHARS,
} from './args.js';
import { removeFallbackContextFile, writeFallbackContextFile } from './context-file.js';
import { buildResumptionEnv } from './env.js';
import {
  FAST_FAILURE_GRACE_MS,
  runInteractive,
  type InteractiveRunResult,
} from './spawn-interactive.js';

const DEFAULT_CLAUDE_BINARY = 'claude';

export interface ClaudeSessionResumerOptions {
  /** Injectable root standing in for `~/.seeya`, where the fallback's scratch file lives
   * (`context-file.ts`, AGENTS.md § "Sistema de arquivos"). */
  readonly seeyaHome: string;
  /** Overridable for tests — points at a fake `claude` script instead of resolving the real
   * binary via `PATH` (mirrors `LeanHandoffGeneratorOptions.claudeBinary`). */
  readonly claudeBinary?: string;
  /** Overridable for tests — see `spawn-interactive.ts#SpawnInteractiveOptions.fastFailureGraceMs`.
   * Defaults to `FAST_FAILURE_GRACE_MS` when omitted. */
  readonly fastFailureGraceMs?: number;
}

/** Everything one `resume()` call needs to pass down to its (possible) fallback attempt, resolved
 * once at the top of `resume()` — one object instead of a growing positional-parameter list. */
interface ResumeCallContext {
  readonly sessionId: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly claudeBinary: string;
  readonly env: NodeJS.ProcessEnv;
  readonly fastFailureGraceMs: number;
}

/**
 * Describes the primary `--resume` attempt for the error thrown when the fallback ALSO fails
 * (S3-T7, Q-029). Two shapes, because the primary attempt itself has two shapes:
 * `resumeFailed` means `claude --resume` actually ran and exited non-zero — show the argv it ran
 * with (redacted per `describeResumeAttempt`) plus that exit code. `promptTooLarge` means the
 * primary attempt was never even tried (`resume()` routes straight to `fallback()` before calling
 * `runInteractive` at all) — saying so plainly matters as much as the other branch: claiming an
 * attempt that never happened would be exactly the D-025 violation this task exists to avoid on
 * the "fact" side, done instead on the "action" side.
 */
function describePrimaryAttempt(context: ResumeCallContext, reason: ResumeFallbackReason): string {
  if (reason.kind === 'promptTooLarge') {
    return (
      `skipped — the plan was ${reason.promptLength} characters, over the ` +
      `${reason.limitChars}-character limit`
    );
  }
  const argv = describeResumeAttempt(context.claudeBinary, context.sessionId, context.prompt);
  return `${argv} (exited with code ${reason.exitCode})`;
}

function isFastFailure(result: InteractiveRunResult): boolean {
  return result.failedFast && result.exitCode !== 0;
}

/** Extracted so the default-resolution branch is unit-testable on its own (`resumer.test.ts`
 * exercises the real spawn path only with an explicit fake binary — actually spawning the literal
 * string `'claude'` in a test would invoke whatever real binary happens to be on the machine's
 * `PATH`, which is exactly what docs/PLANO-DE-ENTREGA.md/CLAUDE.md forbid the test suite from
 * doing). */
export function resolveClaudeBinary(
  options: Pick<ClaudeSessionResumerOptions, 'claudeBinary'>,
): string {
  return options.claudeBinary ?? DEFAULT_CLAUDE_BINARY;
}

export class ClaudeSessionResumer implements SessionResumer {
  constructor(private readonly options: ClaudeSessionResumerOptions) {}

  async resume(sessionId: string, cwd: string, prompt: string): Promise<ResumeOutcome> {
    const context: ResumeCallContext = {
      sessionId,
      cwd,
      prompt,
      claudeBinary: resolveClaudeBinary(this.options),
      env: buildResumptionEnv(process.env),
      fastFailureGraceMs: this.options.fastFailureGraceMs ?? FAST_FAILURE_GRACE_MS,
    };

    if (prompt.length > RESUME_PROMPT_ARG_LIMIT_CHARS) {
      return this.fallback(context, {
        kind: 'promptTooLarge',
        promptLength: prompt.length,
        limitChars: RESUME_PROMPT_ARG_LIMIT_CHARS,
      });
    }

    const primary = await runInteractive({
      claudeBinary: context.claudeBinary,
      args: buildResumeArgs(sessionId, prompt),
      cwd,
      env: context.env,
      fastFailureGraceMs: context.fastFailureGraceMs,
    });
    if (!isFastFailure(primary)) {
      return { sessionId, cwd, fellBack: false };
    }
    return this.fallback(context, { kind: 'resumeFailed', exitCode: primary.exitCode });
  }

  private async fallback(
    context: ResumeCallContext,
    reason: ResumeFallbackReason,
  ): Promise<ResumeOutcome> {
    const { sessionId, cwd, prompt, claudeBinary, env, fastFailureGraceMs } = context;
    const contextFilePath = await writeFallbackContextFile(
      this.options.seeyaHome,
      sessionId,
      prompt,
    );
    let result: InteractiveRunResult;
    try {
      result = await runInteractive({
        claudeBinary,
        args: buildFallbackArgs(contextFilePath),
        cwd,
        env,
        fastFailureGraceMs,
      });
    } finally {
      await removeFallbackContextFile(contextFilePath);
    }
    if (isFastFailure(result)) {
      // S3-T7 (Q-029): this used to say only "Check that claude is on PATH and that <cwd> still
      // exists" — true as a sanity check, but presented as THE explanation when it usually isn't
      // one. D-004's fallback carries the plan via `--append-system-prompt-file`, a flag
      // `claude --help` has never documented (Spike H) and that the maintainer chose to keep
      // using "until it breaks" (Q-029) rather than build machinery around a moving target. When
      // it does break, `claude` rejects the argument and exits fast — indistinguishable, from
      // exit code alone, from a missing binary or a deleted `cwd`. Showing the argv actually
      // attempted (flags only, per `describeResumeAttempt`/`describeFallbackAttempt` — the plan
      // text itself never belongs in an exception) lets whoever reads this identify a renamed or
      // removed flag without being told a cause the evidence doesn't establish (D-025): this
      // reports what was tried and what happened, and leaves PATH/cwd as one thing to rule out,
      // not the diagnosis.
      throw new Error(
        `Fallback session for "${sessionId}" (${cwd}) also failed to start (claude exited with ` +
          `code ${result.exitCode}).\n` +
          `  primary attempt:  ${describePrimaryAttempt(context, reason)}\n` +
          `  fallback attempt: ${describeFallbackAttempt(claudeBinary, contextFilePath)}\n` +
          `If "claude" is on PATH and "${cwd}" still exists, check next whether the installed ` +
          `claude version still recognizes the flags shown above.`,
      );
    }
    return { sessionId, cwd, fellBack: reason };
  }
}
