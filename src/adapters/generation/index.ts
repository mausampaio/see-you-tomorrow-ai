/**
 * Generation adapter: calls headless `claude`, implementing `HandoffGenerator` (`core/ports.ts`)
 * in two variants chosen by config (D-011) — `LeanHandoffGenerator` (default) and
 * `DeepHandoffGenerator` (`deepCapture: true` per project). `cli/`, the only composition root
 * (D-020), is what instantiates whichever one a session's project policy calls for and injects it
 * into `application/endDay` (S2-T3).
 *
 * Everything else in this directory (`args.ts`, `env.ts`, `errors.ts`, `fork-registration.ts`,
 * `prompt.ts`, `run-generation.ts`, `schemas.ts`, `spawn-claude.ts`, `system-prompt.ts`,
 * `understanding-schema.ts`) is this module's own internal wiring — not re-exported, same
 * "adapter's public surface is its `index.ts`" convention `adapters/discovery/index.ts` already
 * follows. `GenerationError`/`GenerationFailureReason` ARE re-exported: a caller catching
 * `generate()`'s rejection needs the type to narrow on.
 */
export { LeanHandoffGenerator, type LeanHandoffGeneratorOptions } from './lean-generator.js';
export { DeepHandoffGenerator, type DeepHandoffGeneratorOptions } from './deep-generator.js';
export { GenerationError, type GenerationFailureReason } from './errors.js';
