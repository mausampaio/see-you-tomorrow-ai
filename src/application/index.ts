/**
 * Application: use cases (endDay, startDay, captureSession) that orchestrate the core and the
 * adapters. See docs/ARQUITETURA.md.
 *
 * `startDay` (S3) and the scheduler-facing pieces of `endDay` (dry-run/session filtering, S2-T5)
 * arrive later — this barrel grows additively the same way `core/ports.ts` and `Storage` already
 * have.
 */
export { endDay } from './end-day.js';
export type {
  CaptureFailure,
  CapturedSession,
  EndDayDeps,
  EndDayResult,
  IneligibleSession,
  TerminationNotice,
} from './types.js';
export { captureSession } from './capture-session.js';
export type { CaptureSessionOutcome, CaptureSessionParams } from './capture-session.js';
