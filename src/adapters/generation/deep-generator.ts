/**
 * `HandoffGenerator`'s opt-in implementation (D-011, `deepCapture: true` per project): resumes
 * the ORIGINAL session's full transcript into a brand-new forked session (D-001, D-012) instead
 * of re-deriving context from `SessionFacts` — this variant never reads `facts` at all, which is
 * why `generate` below only declares the `session` parameter (a function taking fewer parameters
 * than `core/ports.ts#HandoffGenerator` declares is still structurally assignable to it — the
 * same way an `Array.forEach((item) => …)` callback is allowed to ignore `index`/`array`).
 */
import { randomUUID } from 'node:crypto';
import type { Clock, HandoffGenerator } from '../../core/ports.js';
import type { DiscoveredSession, GeneratedUnderstanding } from '../../core/types.js';
import { buildDeepArgs } from './args.js';
import { buildGenerationEnv } from './env.js';
import { registerFork } from './fork-registration.js';
import { DEFAULT_GENERATION_TIMEOUT_MS } from './lean-generator.js';
import { DEEP_GENERATION_PROMPT } from './prompt.js';
import { runGeneration } from './run-generation.js';

const DEFAULT_CLAUDE_BINARY = 'claude';

export interface DeepHandoffGeneratorOptions {
  /** `captureModel` from `config.json`. */
  readonly model: string;
  /** `budgetPerSessionUsd` from `config.json`. */
  readonly budgetPerSessionUsd: number;
  /** Injectable root standing in for `~/.seeya`, where `forks.json` lives (D-012). */
  readonly seeyaHome: string;
  /** D-019: `createdAt` in `forks.json` comes from here, never from a bare `new Date()`. */
  readonly clock: Clock;
  readonly claudeBinary?: string;
  readonly timeoutMs?: number;
}

export class DeepHandoffGenerator implements HandoffGenerator {
  constructor(private readonly options: DeepHandoffGeneratorOptions) {}

  async generate(session: DiscoveredSession): Promise<GeneratedUnderstanding> {
    const {
      model,
      budgetPerSessionUsd,
      seeyaHome,
      clock,
      claudeBinary = DEFAULT_CLAUDE_BINARY,
      timeoutMs = DEFAULT_GENERATION_TIMEOUT_MS,
    } = this.options;
    const forkSessionId = randomUUID();
    // D-012: register BEFORE spawning. `--fork-session` can write the transcript file to disk
    // even if the call below times out or exits non-zero — see fork-registration.ts's docstring
    // for why registering only on success would leak an unregistered fork.
    await registerFork(seeyaHome, forkSessionId, clock.now());
    return runGeneration({
      claudeBinary,
      args: buildDeepArgs({
        model,
        budgetPerSessionUsd,
        resumeSessionId: session.sessionId,
        forkSessionId,
      }),
      stdinContent: DEEP_GENERATION_PROMPT,
      cwd: session.cwd,
      env: buildGenerationEnv(process.env, 'deep'),
      timeoutMs,
    });
  }
}
