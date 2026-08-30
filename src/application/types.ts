/**
 * `endDay`'s own dependency and result shapes (S2-T3, docs/ESPECIFICACAO.md § `seeya end-day`).
 * `EndDayDeps` types every collaborator as a `core/ports.ts` interface, never a concrete adapter
 * (D-020: `application/` cannot import `adapters/` — `cli/`, the only composition root, is what
 * builds the real instances and passes them in).
 */
import type {
  Clock,
  GitReader,
  HandoffGenerator,
  ProcessControl,
  RejectedDiscoveryRecord,
  SessionProvider,
  Storage,
  TranscriptReader,
} from '../core/ports.js';
import type { Day, Handoff } from '../core/types.js';
import type { IneligibilityReason } from '../core/eligibility.js';

/**
 * Every port `endDay` orchestrates. **Both `leanGenerator` and `deepGenerator` are required**, not
 * a single pre-chosen `HandoffGenerator` — the choice between them isn't purely a per-project
 * config value (D-011): a session with no transcript always uses the lean generator regardless of
 * `deepCapture` (D-013 — a deep `--resume` would never find it), and that decision needs the
 * session's own `hasTranscript` at hand, which only `endDay` (not `cli/`'s composition step) knows
 * per session. `cli/` (S2-T5) still names both concrete classes — D-020 isn't broken, it just
 * builds two instances instead of one and lets this use case pick between them per session.
 */
export interface EndDayDeps {
  readonly sessionProvider: SessionProvider;
  readonly transcriptReader: TranscriptReader;
  readonly gitReader: GitReader;
  readonly leanGenerator: HandoffGenerator;
  readonly deepGenerator: HandoffGenerator;
  readonly storage: Storage;
  readonly processControl: ProcessControl;
  readonly clock: Clock;
}

/** One session `evaluateEligibility` (`core/eligibility.ts`) excluded, and why — the "aceitos e
 * rejeitados" half of D-022's contract applied to eligibility instead of parsing. */
export interface IneligibleSession {
  readonly sessionId: string;
  readonly cwd: string;
  readonly name: string;
  readonly reasons: readonly IneligibilityReason[];
}

/**
 * One eligible session whose capture pipeline threw before a handoff could be written — the
 * "isolamento de falha por sessão" requirement (docs/PLANO-DE-ENTREGA.md S2-T3): this session's
 * failure is recorded and `endDay` moves on to the next one, never aborting the batch.
 */
export interface CaptureFailure {
  readonly sessionId: string;
  readonly cwd: string;
  readonly name: string;
  /** AGENTS.md § "Mensagens de erro": the raw failure, not just "capture failed". */
  readonly reason: string;
}

/**
 * Q-007: `terminateGracefully` returned `false` with the process still alive, for a session
 * `canTerminate: true` opted into. Not an error and not aborted — the handoff was written
 * successfully — but silence here is exactly the failure mode Q-007 exists to prevent: whoever
 * turned `canTerminate` on believes the session closed. Named explicitly in `EndDayResult` so a
 * caller (`cli/`, S4-T1's notifier) can't miss it by only checking `failedCaptures`.
 */
export interface TerminationNotice {
  readonly sessionId: string;
  readonly cwd: string;
  readonly name: string;
  readonly reason: string;
}

/** One session that reached a written, disk-verified handoff (D-002's ordering requirement). */
export interface CapturedSession {
  readonly handoff: Handoff;
  /** Whether `ProcessControl.terminateGracefully` was called AND reported success. `false`
   * covers three different, non-error situations at once — the session wasn't opted into
   * `canTerminate`, it has no PID to terminate at all, or termination was attempted and Q-007
   * fired (see `terminationNotices` for that last one specifically). */
  readonly terminated: boolean;
}

/**
 * `endDay`'s full result (docs/PLANO-DE-ENTREGA.md S2-T3's acceptance criteria) — modeled after
 * D-022's "aceitos e rejeitados" contract, extended to every way a session can fail to become a
 * clean, terminated capture: discovery rejections, ineligibility, capture failure, and Q-007's
 * termination notices are all first-class, visible fields, never folded into a single boolean or
 * swallowed because the common case succeeded.
 */
export interface EndDayResult {
  readonly day: Day;
  readonly discoveredCount: number;
  /** D-022, passed through from `SessionProvider.list()` unchanged. */
  readonly rejectedDiscoveries: readonly RejectedDiscoveryRecord[];
  readonly ineligible: readonly IneligibleSession[];
  readonly captured: readonly CapturedSession[];
  readonly failedCaptures: readonly CaptureFailure[];
  readonly terminationNotices: readonly TerminationNotice[];
}
