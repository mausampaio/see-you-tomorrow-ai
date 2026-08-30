/**
 * The per-session pipeline `endDay` runs under its concurrency limit, for one session that has
 * already passed the cheap eligibility stage (`eligibility-assembly.ts`): gather evidence, decide
 * D-026's anti-duplication for real, generate understanding, assemble and persist the handoff, and
 * — only once that's verified on disk — terminate the process if the session opted in (D-002).
 *
 * Every I/O step here can throw; `endDay` (`end-day.ts`) wraps a call to `captureSession` in its
 * own try/catch so one session's failure is isolated (docs/PLANO-DE-ENTREGA.md S2-T3), which is
 * why this module lets exceptions propagate instead of catching them itself — swallowing here
 * would just move the isolation boundary to the wrong layer.
 */
import { classifyState } from '../core/classification.js';
import { processTerminationData } from '../core/termination.js';
import type { ProcessControl } from '../core/ports.js';
import type {
  Config,
  Day,
  DiscoveredSession,
  Handoff,
  HandoffFacts,
  SessionWithPid,
} from '../core/types.js';
import type { IneligibilityReason } from '../core/eligibility.js';
import { evaluateFullEligibility, projectPolicyFor } from './eligibility-assembly.js';
import { gatherEvidence } from './evidence-gathering.js';
import { generateUnderstanding, selectCaptureMode } from './generation-policy.js';
import type { EndDayDeps, TerminationNotice } from './types.js';

/**
 * How long the daemon's own "guarda de turno ativo" window is (docs/ESPECIFICACAO.md § o
 * comportamento do daemon: "checa se o transcript... foi escrito nos últimos 60 s"). `endDay`
 * reuses the same threshold to decide `capturedDuringActiveTurn` without the 5-minute retry loop
 * that belongs to `scheduler/` (S4-T3) — see `core/types.ts#Handoff.capturedDuringActiveTurn`.
 */
const ACTIVE_TURN_WINDOW_MS = 60_000;

/**
 * Terminating a process that just had a graceful `SIGTERM`/`CTRL_BREAK_EVENT` sent to it on
 * Windows measures ~5.5s before the OS reports it dead (S1-T13's measurement, `termination.ts`'s
 * own tests). 10s leaves real margin above that without leaving `endDay` waiting indefinitely on a
 * session that never exits.
 */
const TERMINATION_DEADLINE_MS = 10_000;

function isWithinActiveTurnWindow(lastActivity: Date | null, now: Date): boolean {
  if (lastActivity === null) {
    return false;
  }
  return now.getTime() - lastActivity.getTime() < ACTIVE_TURN_WINDOW_MS;
}

interface HandoffInputs {
  readonly session: DiscoveredSession;
  readonly config: Config;
  readonly now: Date;
  readonly facts: HandoffFacts;
  readonly sources: Handoff['sources'];
}

/** Assembles the handoff document: picks the generator (`selectCaptureMode`), calls it
 * (`generateUnderstanding`), and folds every derived field into the `Handoff` shape
 * (docs/ESPECIFICACAO.md § "Formato do handoff"). */
async function buildHandoff(inputs: HandoffInputs, deps: EndDayDeps): Promise<Handoff> {
  const { session, config, now, facts, sources } = inputs;
  const policy = projectPolicyFor(config, session.cwd);
  const captureMode = selectCaptureMode(session, policy.deepCapture);
  const generator = captureMode === 'deep' ? deps.deepGenerator : deps.leanGenerator;
  const generation = await generateUnderstanding(generator, session, facts);
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    name: session.name,
    capturedAt: now,
    sessionState: classifyState(session, { now, idleMinutes: config.idleMinutes }),
    capturedDuringActiveTurn: isWithinActiveTurnWindow(facts.lastActivity, now),
    source: generation.source,
    captureMode,
    sources,
    facts,
    understanding: generation.understanding,
    pendingItems: generation.pendingItems,
    tomorrowPlan: generation.tomorrowPlan,
    generationError: generation.generationError,
  };
}

function buildTerminationNotice(session: SessionWithPid, pid: number): TerminationNotice {
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    name: session.name,
    reason: `terminateGracefully returned false; process pid ${pid} is still alive (Q-007)`,
  };
}

/** D-002's opt-in termination, attempted only for a `SessionWithPid` whose project policy set
 * `canTerminate: true` — the caller has already narrowed by the time this runs. Q-007: a `false`
 * result (process still alive) is reported as a `TerminationNotice`, never silently treated as
 * "nothing to say". */
async function terminateEligibleSession(
  processControl: ProcessControl,
  session: SessionWithPid,
): Promise<{ readonly terminated: boolean; readonly notice: TerminationNotice | null }> {
  const { pid } = processTerminationData(session);
  const terminated = await processControl.terminateGracefully(pid, TERMINATION_DEADLINE_MS);
  return terminated
    ? { terminated: true, notice: null }
    : { terminated: false, notice: buildTerminationNotice(session, pid) };
}

/**
 * D-002's ordering, enforced by construction: `saveHandoff` then `readHandoff` to verify the write
 * actually landed — only THEN does termination get a chance to run at all. A rejected
 * `saveHandoff`, or a verification read that comes back `null` (D-002's "falha na captura aborta o
 * encerramento"), throws before `terminateEligibleSession` is ever called.
 */
async function persistAndMaybeTerminate(
  deps: EndDayDeps,
  day: Day,
  handoff: Handoff,
  session: DiscoveredSession,
  canTerminate: boolean,
): Promise<{ readonly terminated: boolean; readonly notice: TerminationNotice | null }> {
  await deps.storage.saveHandoff(day, handoff);
  const verified = await deps.storage.readHandoff(day, handoff.sessionId);
  if (verified === null) {
    throw new Error(
      `handoff for session "${handoff.sessionId}" was saved but could not be read back ` +
        `from "${day}" — refusing to terminate the process without a verified handoff (D-002)`,
    );
  }
  if (!canTerminate || !session.hasPid) {
    return { terminated: false, notice: null };
  }
  return terminateEligibleSession(deps.processControl, session);
}

export type CaptureSessionOutcome =
  | { readonly kind: 'ineligible'; readonly reasons: readonly IneligibilityReason[] }
  | {
      readonly kind: 'captured';
      readonly handoff: Handoff;
      readonly terminated: boolean;
      readonly terminationNotice: TerminationNotice | null;
    };

export interface CaptureSessionParams {
  readonly deps: EndDayDeps;
  readonly session: DiscoveredSession;
  readonly config: Config;
  readonly now: Date;
  readonly day: Day;
}

/**
 * Runs the full pipeline for one session that already passed the cheap eligibility stage. Returns
 * `{ kind: 'ineligible' }` when D-026's anti-duplication (the only condition the cheap stage
 * couldn't decide) disqualifies it after all — evidence had to be gathered to find out, but no
 * handoff is written for a duplicate.
 */
export async function captureSession(params: CaptureSessionParams): Promise<CaptureSessionOutcome> {
  const { deps, session, config, now, day } = params;
  const evidence = await gatherEvidence(deps.transcriptReader, deps.gitReader, session);
  const eligibility = await evaluateFullEligibility(
    session,
    now,
    config,
    deps.storage,
    day,
    evidence.facts,
  );
  if (!eligibility.eligible) {
    return { kind: 'ineligible', reasons: eligibility.reasons };
  }

  const handoff = await buildHandoff(
    { session, config, now, facts: evidence.facts, sources: evidence.sources },
    deps,
  );
  const policy = projectPolicyFor(config, session.cwd);
  const { terminated, notice } = await persistAndMaybeTerminate(
    deps,
    day,
    handoff,
    session,
    policy.canTerminate,
  );
  return { kind: 'captured', handoff, terminated, terminationNotice: notice };
}
