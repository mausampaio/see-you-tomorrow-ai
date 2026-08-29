/**
 * The CLI argument arrays for both generator variants (D-011). Every value here is either a fixed
 * flag name, a short known value (`--model sonnet`, a dollar amount, a UUID), or the fixed
 * `--system-prompt`/`--json-schema` strings this module owns — never the variable-length prompt
 * text, which always travels on stdin instead (D-015, see `prompt.ts`/`spawn-claude.ts`).
 */
import { GENERATION_SYSTEM_PROMPT } from './system-prompt.js';
import { UNDERSTANDING_JSON_SCHEMA } from './understanding-schema.js';

export interface CommonGenerationArgsOptions {
  readonly model: string;
  readonly budgetPerSessionUsd: number;
}

/** Flags both variants share: print mode, JSON output, no tools (D-011's token-floor
 * optimization, Spike C), the fixed extractor system prompt, the understanding JSON schema, and a
 * hard dollar ceiling (`--max-budget-usd`, docs/ARQUITETURA.md § `generation/`). */
function buildCommonArgs(options: CommonGenerationArgsOptions): string[] {
  return [
    '-p',
    '--model',
    options.model,
    '--output-format',
    'json',
    '--tools',
    '',
    '--system-prompt',
    GENERATION_SYSTEM_PROMPT,
    '--json-schema',
    UNDERSTANDING_JSON_SCHEMA,
    '--max-budget-usd',
    String(options.budgetPerSessionUsd),
  ];
}

/** Lean (default, D-011): a fresh, disposable session — `--no-session-persistence` (D-017's
 * table: lean wants no persistence at all, expressed as a CLI flag, not an environment
 * variable). */
export function buildLeanArgs(options: CommonGenerationArgsOptions): string[] {
  return [...buildCommonArgs(options), '--no-session-persistence'];
}

export interface DeepGenerationArgsOptions extends CommonGenerationArgsOptions {
  /** The ORIGINAL session's `sessionId` — what `--resume` looks up. */
  readonly resumeSessionId: string;
  /** The fork's own `sessionId`, chosen by the caller BEFORE spawning (`--session-id`) so it can
   * be registered in `forks.json` (D-012) ahead of the call — see `deep-generator.ts`. Confirmed
   * for real (S2-T2, claude 2.1.235): `--resume <id> --fork-session --session-id <uuid>` makes
   * the fork's `session_id` in the output, and the `.jsonl` file it writes, exactly `<uuid>`. */
  readonly forkSessionId: string;
}

/** Deep (opt-in, D-011): resumes the live session's full transcript into a fork, per D-001/D-012. */
export function buildDeepArgs(options: DeepGenerationArgsOptions): string[] {
  return [
    ...buildCommonArgs(options),
    '--resume',
    options.resumeSessionId,
    '--fork-session',
    '--session-id',
    options.forkSessionId,
  ];
}
