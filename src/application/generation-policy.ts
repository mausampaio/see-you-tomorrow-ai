/**
 * D-003's fallback decision and D-013/D-011's generator selection — the one piece
 * `docs/ARQUITETURA.md § generation/` explicitly assigns to `application/`, not the adapter:
 * "Erro tipado. Quem decide o fallback é `application/`, não o adapter." Nothing here does I/O
 * directly; it calls the `HandoffGenerator` port and interprets the outcome.
 */
import type { HandoffGenerator } from '../core/ports.js';
import type {
  CaptureMode,
  DiscoveredSession,
  GeneratedUnderstanding,
  HandoffSource,
  SessionFacts,
} from '../core/types.js';

/**
 * Which `HandoffGenerator` this session's capture uses. **A session with no transcript always
 * gets `lean`, regardless of `deepCapture`** (D-013: the deep generator's `--resume` would not
 * find a session Claude Code never persisted — attempting it anyway would just be a slower way to
 * fail, not a better handoff). Only when a transcript exists does the project's own `deepCapture`
 * policy (D-011) get to choose.
 */
export function selectCaptureMode(session: DiscoveredSession, deepCapture: boolean): CaptureMode {
  if (!session.hasTranscript) {
    return 'lean';
  }
  return deepCapture ? 'deep' : 'lean';
}

export interface GenerationOutcome {
  readonly source: HandoffSource;
  readonly understanding: string;
  readonly pendingItems: readonly string[];
  readonly tomorrowPlan: readonly string[];
  readonly generationError: string | null;
}

/** D-003's failure fallback: the facts alone, no fabricated understanding (D-025 — an empty
 * string/list here is "nothing to say", never invented content standing in for a real answer). */
function deterministicOutcome(hasTranscript: boolean, message: string): GenerationOutcome {
  return {
    source: hasTranscript ? 'deterministic' : 'noTranscript',
    understanding: '',
    pendingItems: [],
    tomorrowPlan: [],
    generationError: message,
  };
}

function successOutcome(hasTranscript: boolean, result: GeneratedUnderstanding): GenerationOutcome {
  return {
    source: hasTranscript ? 'model' : 'noTranscript',
    understanding: result.understanding,
    pendingItems: result.pendingItems,
    tomorrowPlan: result.tomorrowPlan,
    generationError: null,
  };
}

/**
 * Picks the generator (`selectCaptureMode`), calls it, and turns the outcome into the three-way
 * `HandoffSource` split `core/types.ts#HandoffSource` documents. Never lets `generator.generate()`
 * throwing escape as an unhandled rejection — `application/endDay`'s per-session isolation only
 * protects the SESSION as a whole; this is what stops a generation failure from being anything
 * other than D-003's documented fallback.
 *
 * **Doesn't `instanceof GenerationError`.** That class lives in `adapters/generation/`, which
 * `application/` cannot import (D-020's layer matrix) even though `core/ports.ts#HandoffGenerator`
 * names it in prose — every `Error` already carries a `.message` (AGENTS.md § "Mensagens de
 * erro"), which is all D-003's fallback needs to record. A non-`Error` rejection (should not
 * happen, given the port's own contract) still gets a message via `String(error)`, never left
 * blank.
 */
export async function generateUnderstanding(
  generator: HandoffGenerator,
  session: DiscoveredSession,
  facts: SessionFacts,
): Promise<GenerationOutcome> {
  try {
    const result = await generator.generate(session, facts);
    return successOutcome(session.hasTranscript, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return deterministicOutcome(session.hasTranscript, message);
  }
}
