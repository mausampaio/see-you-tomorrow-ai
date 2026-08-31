/**
 * `HandoffGenerator.generate()`'s typed failure (docs/ARQUITETURA.md § `generation/`: "Erro
 * tipado. Quem decide o fallback é application/, não o adapter") — every way the `claude` call
 * can fail to produce a usable `GeneratedUnderstanding`, as a discriminated union rather than one
 * error type with several optional fields (D-024: the shape itself should say which failure this
 * is, not leave a caller guessing which fields are populated).
 *
 * Same idiom as `adapters/storage/schema-version.ts#UnsupportedSchemaVersionError`: a named
 * `Error` subclass carrying the structured `reason` alongside a human `message`, so a catcher can
 * either read `error.message` (AGENTS.md § "Mensagens de erro": names the offending value and the
 * expected shape) or pattern-match on `error.reason.kind` without re-parsing the message string.
 */

export type GenerationFailureReason =
  | { readonly kind: 'spawnError'; readonly message: string }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  // `stdout` added in S4-T00d: a non-zero exit code says nothing about whether stdout is
  // readable. `run-generation.ts` only reaches this branch after trying (and failing) to read
  // `stdout` as claude's own `--output-format json` envelope, so the raw text is the only
  // evidence left — same reasoning `invalidJson` already applied to its own `raw`.
  | {
      readonly kind: 'nonZeroExit';
      readonly exitCode: number;
      readonly stderr: string;
      readonly stdout: string;
    }
  | { readonly kind: 'invalidJson'; readonly raw: string; readonly message: string }
  | { readonly kind: 'invalidOutputShape'; readonly raw: unknown; readonly message: string }
  | { readonly kind: 'invalidUnderstandingShape'; readonly raw: unknown; readonly message: string }
  // `exitCode` added in S4-T00d: claude reports `is_error` inside this envelope on stdout
  // regardless of the process's own exit code (`run-generation.ts` reaches this variant from
  // both a clean exit and a non-zero one). Always the exit code actually observed, never
  // defaulted — a reader distinguishing "model reported failure, process still exited 0" from
  // "model reported failure, process ALSO exited non-zero" gets both facts, no inferred cause
  // (D-025: report what was observed, not a guess about which one explains the other).
  | {
      readonly kind: 'modelReportedError';
      readonly subtype: string;
      readonly result: string;
      readonly exitCode: number;
    };

// `result` above can carry arbitrary model-produced text, and `describe()`'s return value ends up
// verbatim in `generationError`, which is written into the handoff on disk
// (`application/generation-policy.ts`). Capped here — not in `run-generation.ts` — so the full,
// untruncated `result` still reaches anyone pattern-matching on `error.reason.result`
// programmatically; only the rendered message that goes to disk is bounded. 500 characters is
// enough to read what the model said without turning a disk-persisted error field into a copy of
// its output (S4-T00d).
const MAX_MODEL_RESULT_CHARS = 500;

function truncateModelResult(result: string): string {
  if (result.length <= MAX_MODEL_RESULT_CHARS) {
    return result;
  }
  const omittedChars = result.length - MAX_MODEL_RESULT_CHARS;
  return `${result.slice(0, MAX_MODEL_RESULT_CHARS)}… (${omittedChars} more characters omitted)`;
}

function describe(reason: GenerationFailureReason): string {
  switch (reason.kind) {
    case 'spawnError':
      return `failed to spawn the claude process: ${reason.message}`;
    case 'timeout':
      return `claude did not finish within the ${reason.timeoutMs}ms hard timeout`;
    case 'nonZeroExit':
      return (
        `claude exited with code ${reason.exitCode}, expected 0. stderr: ` +
        (reason.stderr.length > 0 ? reason.stderr : '(empty)') +
        `. stdout: ${reason.stdout.length > 0 ? reason.stdout : '(empty)'}`
      );
    case 'invalidJson':
      return `claude's stdout is not valid JSON: ${reason.message}. Raw stdout:\n${reason.raw}`;
    case 'invalidOutputShape':
      return `claude's parsed stdout doesn't match the expected output shape: ${reason.message}`;
    case 'invalidUnderstandingShape':
      return (
        `claude's understanding payload doesn't match {understanding, pendingItems, ` +
        `tomorrowPlan}: ${reason.message}`
      );
    case 'modelReportedError':
      return (
        `claude reported is_error (exit code ${reason.exitCode}) with subtype ` +
        `"${reason.subtype}". result: ${truncateModelResult(reason.result)}`
      );
  }
}

/**
 * Thrown by every step of `adapters/generation`'s call path (`spawn-claude.ts`, `run-generation.ts`)
 * on failure. `application/endDay` (S2-T3) is the intended catcher: it decides the D-003 fallback
 * (`source: "deterministic"`, `generationError: error.message`) — this class only reports, never
 * decides.
 */
export class GenerationError extends Error {
  constructor(readonly reason: GenerationFailureReason) {
    super(describe(reason));
    this.name = 'GenerationError';
  }
}
