/**
 * Scheduler: the long-running daemon that orchestrates `application/` over time (D-005, S4-T3). See
 * docs/ARQUITETURA.md.
 *
 * Convenience barrel, same pattern `core/index.ts`/`application/index.ts` already use — `cli/`
 * (D-020) is the only importer, since `scheduler/` cannot be reached from anywhere else in the
 * layer matrix.
 */
export { runDaemon, POLL_INTERVAL_MS } from './loop.js';
export type { RunDaemonOptions, DaemonRunOutcome } from './loop.js';
export { pollOnce } from './poll.js';
export { checkDaemonLock, acquireDaemonLock } from './lock.js';
export type { DaemonDeps } from './types.js';
export {
  buildLeadTimeNotice,
  buildDaemonEndOfDayNotice,
  buildEarlyWarningNotice,
} from './notices.js';
export { buildRetryFilter, nonModelSessionIds } from './capture-filter.js';
