/**
 * Core: pure domain rules and ports.
 *
 * Imports no `node:*` nor anything from `application/`, `cli/` or `adapters/`. No I/O, no
 * clock, no network, no process. See docs/ARQUITETURA.md.
 *
 * Convenience barrel (S1-T1). Whoever prefers can import directly from the specific module
 * (e.g. `core/classification.js`) — both paths work.
 */
export * from './types.js';
export * from './day.js';
export * from './evidence.js';
export * from './classification.js';
export * from './eligibility.js';
export * from './termination.js';
export * from './early-warnings.js';
export * from './ports.js';
