/**
 * Application: use cases (endDay, startDay, captureSession) that orchestrate the core and the
 * adapters. See docs/ARQUITETURA.md.
 *
 * `startDay` (S3) arrives later — this barrel grows additively the same way `core/ports.ts` and
 * `Storage` already have. `--dry-run`/`--session` (S2-T5) are `EndDayOptions`, exported below.
 */
export { endDay } from './end-day.js';
export type {
  CaptureFailure,
  CapturedSession,
  EndDayDeps,
  EndDayOptions,
  EndDayResult,
  IneligibleSession,
  TerminationNotice,
} from './types.js';
export { captureSession } from './capture-session.js';
export type { CaptureSessionOutcome, CaptureSessionParams } from './capture-session.js';
