/**
 * Pure mapping from a validated `SessionRecord` (schemas.ts) plus already-resolved liveness and
 * transcript info into the domain type `SessionWithPid` (core/types.ts). No I/O here — the
 * caller (registry.ts) does all the reading; this module only decides field values, which is why
 * it's tested at unit level (docs/TESTES.md) even though it lives in an adapter.
 */
import type { SessionWithPid } from '../../core/types.js';
import type { SessionRecord } from './schemas.js';

/**
 * D-021's default for a missing display name: the last path segment of `cwd`. Manual split on
 * both separators — not `node:path.basename` — because `cwd` is a string read from an external
 * record and may have been written on a different OS than the one running discovery right now
 * (e.g. a Windows-shaped fixture exercised on Linux CI, or `~/.seeya` data inspected on another
 * machine); `path.basename` only understands the current platform's separator. This is a
 * display-string transform, not a filesystem path construction used for I/O, so it doesn't fall
 * under "always node:path" (AGENTS.md) — that rule exists to stop hand-rolled paths from being
 * used to *touch the disk*, which this never does.
 */
export function deriveNameFromCwd(cwd: string): string {
  const segments = cwd.split(/[/\\]+/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? cwd;
}

/**
 * `lastActivity` per `DiscoveredSession`'s contract (core/types.ts): "the most recent known
 * activity ... across every source available at discovery time". At this point (S1-T3, registry
 * strategy only) the sources available are `startedAt` from the record and the transcript's
 * mtime, when it exists — git (S2-T1) isn't wired in yet. Always returns a real `Date`, never
 * `null`: `startedAt` is a required field of `sessionRecordSchema`, so the registry strategy
 * always has at least one source, unlike the transcript-scan strategy (S1-T8) which can be
 * evidence-free.
 */
export function computeLastActivity(startedAt: number, lastTranscriptWrite: Date | null): Date {
  const startedAtInstant = new Date(startedAt);
  if (lastTranscriptWrite !== null && lastTranscriptWrite.getTime() > startedAtInstant.getTime()) {
    return lastTranscriptWrite;
  }
  return startedAtInstant;
}

/** Liveness and transcript facts, both already resolved by the caller — this module does no I/O. */
export interface LivenessAndTranscript {
  readonly processIsAlive: boolean;
  readonly hasTranscript: boolean;
  readonly lastTranscriptWrite: Date | null;
}

/**
 * Assembles the domain `SessionWithPid` from a validated record. `sessionRecordSchema` requires
 * `pid`, so every record the registry strategy accepts produces this shape, never
 * `SessionWithoutPid` — that shape is D-016's transcript-scan strategy (S1-T8).
 *
 * A dead PID (`info.processIsAlive: false`) still produces a normal `SessionWithPid` here, not a
 * rejection: `docs/ESPECIFICACAO.md` § "Como as sessões são descobertas" is explicit that a stale
 * registry entry is "reported as an ended session, not discarded — it still has a transcript and
 * still deserves a handoff". `core/classification.ts#classifyState` is what turns
 * `processIsAlive: false` into the `ended` state; this function only carries the fact through.
 */
export function buildSessionWithPid(
  record: SessionRecord,
  info: LivenessAndTranscript,
): SessionWithPid {
  return {
    hasPid: true,
    sessionId: record.sessionId,
    cwd: record.cwd,
    name: record.name ?? deriveNameFromCwd(record.cwd),
    pid: record.pid,
    procStart: record.procStart,
    processIsAlive: info.processIsAlive,
    hasTranscript: info.hasTranscript,
    lastTranscriptWrite: info.lastTranscriptWrite,
    lastActivity: computeLastActivity(record.startedAt, info.lastTranscriptWrite),
  };
}
