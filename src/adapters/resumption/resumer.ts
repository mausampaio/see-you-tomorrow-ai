/**
 * `SessionResumer`'s only implementation (S3-T2, D-004). Ties together this directory's other
 * modules: `args.ts` decides the argument shape and the size ceiling, `env.ts` sanitizes per
 * D-017, `spawn-interactive.ts` is the one place a real process gets spawned, and
 * `context-file.ts` is the fallback's scratch file. This file's own job is the branching: which of
 * the two attempts runs, and what `ResumeFallbackReason` (if any) the caller sees.
 */
import type { SessionResumer } from '../../core/ports.js';
import type { ResumeFallbackReason, ResumeOutcome } from '../../core/types.js';
import { buildFallbackArgs, buildResumeArgs, RESUME_PROMPT_ARG_LIMIT_CHARS } from './args.js';
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

/** A fallback attempt that itself fails fast means nothing actually opened — throwing here (never
 * a `ResumeOutcome` claiming a fresh session started) is D-025 applied to an action instead of a
 * fact: an outcome that didn't happen must never be reported as if it had. */
function describeReasonForError(reason: ResumeFallbackReason): string {
  return reason.kind === 'resumeFailed'
    ? `the original --resume attempt failed with exit code ${reason.exitCode}`
    : `the plan was ${reason.promptLength} characters, over the ${reason.limitChars}-character limit`;
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
      throw new Error(
        `Fallback session for "${sessionId}" (${cwd}) also failed to start (claude exited with ` +
          `code ${result.exitCode}) after ${describeReasonForError(reason)}. Check that "claude" ` +
          `is on PATH and that "${cwd}" still exists.`,
      );
    }
    return { sessionId, cwd, fellBack: reason };
  }
}
