/**
 * Resumption adapter: implements `SessionResumer` (`core/ports.ts`, S3-T2, D-004) by spawning
 * `claude` with the child's stdio inherited from `seeya`'s own terminal (docs/spikes/
 * H-retomada-interativa.md). `cli/` (S3-T3, not built yet) will be the only module that names
 * `ClaudeSessionResumer` (D-020).
 *
 * Everything else in this directory (`args.ts`, `context-file.ts`, `env.ts`,
 * `spawn-interactive.ts`) is this module's own internal wiring — not re-exported, same "an
 * adapter's public surface is its `index.ts`" convention `adapters/discovery/index.ts` and
 * `adapters/generation/index.ts` already follow.
 */
export { ClaudeSessionResumer, type ClaudeSessionResumerOptions } from './resumer.js';
