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
  | { readonly kind: 'nonZeroExit'; readonly exitCode: number; readonly stderr: string }
  | { readonly kind: 'invalidJson'; readonly raw: string; readonly message: string }
  | { readonly kind: 'invalidOutputShape'; readonly raw: unknown; readonly message: string }
  | { readonly kind: 'invalidUnderstandingShape'; readonly raw: unknown; readonly message: string }
  | { readonly kind: 'modelReportedError'; readonly subtype: string; readonly result: string };

function describe(reason: GenerationFailureReason): string {
  switch (reason.kind) {
    case 'spawnError':
      return `failed to spawn the claude process: ${reason.message}`;
    case 'timeout':
      return `claude did not finish within the ${reason.timeoutMs}ms hard timeout`;
    case 'nonZeroExit':
      return (
        `claude exited with code ${reason.exitCode}, expected 0. stderr: ` +
        (reason.stderr.length > 0 ? reason.stderr : '(empty)')
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
      return `claude reported is_error with subtype "${reason.subtype}". result: ${reason.result}`;
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
