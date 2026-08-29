/**
 * `HandoffGenerator`'s default implementation (D-011): a fresh, disposable `claude -p` session
 * built from `SessionFacts` alone, never touching the original session's transcript. `cli/` (the
 * only composition root, D-020) instantiates this for any project whose `deepCapture` policy
 * isn't `true` — see `deep-generator.ts` for the opt-in alternative.
 */
import type { DiscoveredSession, GeneratedUnderstanding, SessionFacts } from '../../core/types.js';
import type { HandoffGenerator } from '../../core/ports.js';
import { buildLeanArgs } from './args.js';
import { buildGenerationEnv } from './env.js';
import { buildLeanPrompt } from './prompt.js';
import { runGeneration } from './run-generation.js';

/** Hard timeout (docs/ARQUITETURA.md § `generation/`: "Timeout duro"). Spike C's lean-equivalent
 * call took ~34s wall time for a tiny fabricated context; this leaves generous margin for real
 * network variance without letting a stuck call block `endDay` (S2-T3) forever. An instance
 * option (not a bare constant) so a test can exercise the "claude hangs" fixture in milliseconds
 * instead of two minutes. */
export const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;

const DEFAULT_CLAUDE_BINARY = 'claude';

export interface LeanHandoffGeneratorOptions {
  /** `captureModel` from `config.json` (docs/ARQUITETURA.md § Config). */
  readonly model: string;
  /** `budgetPerSessionUsd` from `config.json`, passed straight through as `--max-budget-usd`. */
  readonly budgetPerSessionUsd: number;
  /** Overridable for tests — points PATH at a fake `claude` script instead of resolving the real
   * binary (docs/TESTES.md § `generation/`). Defaults to the bare name, resolved via `PATH`. */
  readonly claudeBinary?: string;
  readonly timeoutMs?: number;
}

export class LeanHandoffGenerator implements HandoffGenerator {
  constructor(private readonly options: LeanHandoffGeneratorOptions) {}

  async generate(session: DiscoveredSession, facts: SessionFacts): Promise<GeneratedUnderstanding> {
    const {
      model,
      budgetPerSessionUsd,
      claudeBinary = DEFAULT_CLAUDE_BINARY,
      timeoutMs = DEFAULT_GENERATION_TIMEOUT_MS,
    } = this.options;
    return runGeneration({
      claudeBinary,
      args: buildLeanArgs({ model, budgetPerSessionUsd }),
      stdinContent: buildLeanPrompt(session, facts),
      cwd: session.cwd,
      env: buildGenerationEnv(process.env, 'lean'),
      timeoutMs,
    });
  }
}
