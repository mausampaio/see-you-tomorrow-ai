/**
 * The shared call path both `LeanHandoffGenerator` and `DeepHandoffGenerator` run after building
 * their own arguments/env/prompt (D-011: "duas implementações atrás da mesma porta" — this is the
 * "mesma porta" part, factored out once instead of duplicated in both generator classes): spawn
 * `claude`, parse its `--output-format json` stdout, and pull the `{understanding, pendingItems,
 * tomorrowPlan}` payload out of it. Every failure along the way is a typed `GenerationError`
 * rejection (docs/ARQUITETURA.md § `generation/`) — never a `GeneratedUnderstanding` standing in
 * for "nothing happened".
 */
import { z } from 'zod';
import type { GeneratedUnderstanding } from '../../core/types.js';
import { GenerationError } from './errors.js';
import { claudePrintOutputSchema, type ClaudePrintOutput } from './schemas.js';
import { spawnClaude, type SpawnClaudeOptions } from './spawn-claude.js';
import { generatedUnderstandingContentSchema } from './understanding-schema.js';

/** Every `JSON.parse` in this file goes through this one wrapper so both call sites (claude's
 * whole stdout, and the `result` fallback in `extractUnderstanding`) report the same
 * `invalidJson` reason shape instead of each inventing their own message. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GenerationError({ kind: 'invalidJson', raw, message: String(error) });
  }
}

/** Parses and validates `claude`'s stdout against `claudePrintOutputSchema` (D-022: no
 * `JSON.parse` without a zod schema right behind it). */
function parseClaudeOutput(stdout: string): ClaudePrintOutput {
  const parsed = parseJson(stdout);
  const result = claudePrintOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new GenerationError({
      kind: 'invalidOutputShape',
      raw: parsed,
      message: z.prettifyError(result.error),
    });
  }
  return result.data;
}

/**
 * Pulls `{understanding, pendingItems, tomorrowPlan}` out of a successful `ClaudePrintOutput`.
 * Prefers `output.structured_output` — the already-parsed object `--json-schema` adds (confirmed
 * for real, see `understanding-schema.ts`) — and only falls back to `JSON.parse(output.result)`
 * when it's absent, so a call made without `--json-schema` (none in production today, but nothing
 * here should assume that never happens) still has a path to a valid result.
 */
function extractUnderstanding(output: ClaudePrintOutput): GeneratedUnderstanding {
  const candidate = output.structured_output ?? parseJson(output.result);
  const result = generatedUnderstandingContentSchema.safeParse(candidate);
  if (!result.success) {
    throw new GenerationError({
      kind: 'invalidUnderstandingShape',
      raw: candidate,
      message: z.prettifyError(result.error),
    });
  }
  return {
    understanding: result.data.understanding,
    pendingItems: result.data.pendingItems,
    tomorrowPlan: result.data.tomorrowPlan,
  };
}

/**
 * Spawns `claude` with `options` and returns the validated `GeneratedUnderstanding`, or rejects
 * with a `GenerationError` naming exactly which step failed: the spawn itself, a non-zero exit,
 * stdout that isn't JSON, JSON that doesn't match `claudePrintOutputSchema`, the model reporting
 * `is_error`, or a `structured_output`/`result` that doesn't match the requested understanding
 * shape.
 */
export async function runGeneration(options: SpawnClaudeOptions): Promise<GeneratedUnderstanding> {
  const { stdout, stderr, exitCode } = await spawnClaude(options);
  if (exitCode !== 0) {
    throw new GenerationError({ kind: 'nonZeroExit', exitCode, stderr });
  }
  const output = parseClaudeOutput(stdout);
  if (output.is_error) {
    throw new GenerationError({
      kind: 'modelReportedError',
      subtype: output.subtype,
      result: output.result,
    });
  }
  return extractUnderstanding(output);
}
