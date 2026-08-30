/**
 * `ForkCleanup`'s implementation (`core/ports.ts`, S2-T6): deletes forks `seeya` itself created
 * and registered (D-012) once they're older than `forkCleanupDays`. This is the **only** module in
 * the project allowed to delete a file inside `~/.claude/projects/` — the single, narrow exception
 * D-012 carves out of "nunca escreva em `~/.claude/`" (AGENTS.md § "Sistema de arquivos"), and only
 * for a `sessionId` this module itself finds already listed in `<seeyaHome>/forks.json`, written by
 * `adapters/generation/fork-registration.ts`. It never accepts a path from a caller.
 *
 * Reuses two siblings instead of duplicating them (AGENTS.md: "nada de duplicação"):
 * `fork-registry.ts`'s reader (`readForkRegistryEntries`, same D-022 "both sides" contract every
 * other reader in this adapter already returns) and `transcript-lookup.ts`'s
 * `locateTranscriptFile` — the same lookup `adapters/transcript` uses to find a real transcript to
 * open for reading, used here once, to delete.
 */
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  Clock,
  ForkCleanup,
  ForkCleanupOutcome,
  ForkCleanupResult,
} from '../../core/ports.js';
import { planForkCleanup, type ForkAge } from '../../core/fork-cleanup.js';
import { writeFileAtomic } from '../storage/atomic-write.js';
import { isEnoent } from './fs-errors.js';
import { locateTranscriptFile } from './transcript-lookup.js';
import {
  FORK_REGISTRY_SCHEMA_VERSION,
  forkRegistryPath,
  forkRejectionsAsRecords,
  readForkRegistryEntries,
  type ForkRegistryEntry,
} from './fork-registry.js';

export interface DiscoveryForkCleanupOptions {
  /** Injectable root standing in for `~/.claude` (never read from `os.homedir()` here) — where a
   * fork's own transcript lives, under `<claudeHome>/projects/<slug>/<sessionId>.jsonl`. */
  readonly claudeHome: string;
  /** Injectable root standing in for `~/.seeya`, where `forks.json` itself lives (D-027). */
  readonly seeyaHome: string;
  readonly clock: Clock;
}

/**
 * `entry.createdAt` is an ISO string on disk (Q-008, docs/QUESTOES.md). `new Date(value)` *with*
 * an argument is a deterministic transform, not a read of "now" — allowed outside `adapters/clock/`
 * (D-019). An entry with no `createdAt` at all (hand-edited, or written before Q-008 fixed the
 * field) resolves to `null`, never a guessed instant: `core/fork-cleanup.ts#planForkCleanup`
 * treats `null` as "age unknown", and D-025 is explicit that unknown age is never read as "old".
 */
function toForkAge(entry: ForkRegistryEntry): ForkAge {
  return {
    sessionId: entry.sessionId,
    createdAt: entry.createdAt === undefined ? null : new Date(entry.createdAt),
  };
}

/**
 * Deletes one fork's transcript file. `locateTranscriptFile` finding nothing (the user deleted it
 * by hand, or it never existed) and `unlink` failing with `ENOENT` are the same case:
 * `alreadyAbsent`, never an error (D-025) — D-012's exception exists to guard against
 * rediscovery, and nothing left on disk can trigger that. Any other failure (permission denied, a
 * locked file) is `failed`, named with the raw error, and does not throw: D-022's "uma falha não
 * aborta as outras" applies to a deletion loop exactly as it applies to a validation loop.
 */
async function deleteOneFork(claudeHome: string, sessionId: string): Promise<ForkCleanupOutcome> {
  const projectsDir = path.join(claudeHome, 'projects');
  try {
    const transcriptPath = await locateTranscriptFile(projectsDir, sessionId);
    if (transcriptPath === null) {
      return { sessionId, outcome: 'alreadyAbsent' };
    }
    await unlink(transcriptPath);
    return { sessionId, outcome: 'deleted' };
  } catch (error) {
    // Covers a real TOCTOU window (something else removes the file between `locateTranscriptFile`
    // finding it and this `unlink` running), not tested directly: reproducing it deterministically
    // would need mocking node:fs/promises, a pattern this project's fs-facing tests avoid in favor
    // of exercising real tmpdir I/O end to end (docs/TESTES.md). The `transcriptPath === null`
    // branch above already proves the `alreadyAbsent` outcome/D-025 reasoning; this branch only
    // reaches the same outcome through the other order the race can happen in.
    if (isEnoent(error)) {
      return { sessionId, outcome: 'alreadyAbsent' };
    }
    return { sessionId, outcome: 'failed', reason: String(error) };
  }
}

/**
 * Rewrites `forks.json` dropping every entry whose fork is fully handled (`deleted` or
 * `alreadyAbsent`) — see this module's top comment / docs/QUESTOES.md for why. A `failed` entry is
 * kept so the next run retries it; an entry that was never stale (`planForkCleanup`'s `kept`) is
 * always kept, untouched. Skips the write entirely when nothing was handled, so a run that finds
 * nothing to clean up never touches `forks.json` at all (same "don't write on every idle pass"
 * discipline `adapters/discovery/early-warnings.ts` already follows).
 */
async function dropHandledEntries(
  seeyaHome: string,
  entries: readonly ForkRegistryEntry[],
  outcomes: readonly ForkCleanupOutcome[],
): Promise<void> {
  const handled = new Set(
    outcomes.filter((outcome) => outcome.outcome !== 'failed').map((outcome) => outcome.sessionId),
  );
  if (handled.size === 0) {
    return;
  }
  const remaining = entries.filter((entry) => !handled.has(entry.sessionId));
  const document = { schemaVersion: FORK_REGISTRY_SCHEMA_VERSION, forks: remaining };
  await writeFileAtomic(forkRegistryPath(seeyaHome), JSON.stringify(document, null, 2));
}

/**
 * `ForkCleanup`'s concrete implementation (D-012, S2-T6). `cleanup()`:
 *
 * 1. Reads `forks.json` (D-022: malformed entries are reported via `rejected`, never abort the
 *    read of the valid ones).
 * 2. Asks `core/fork-cleanup.ts#planForkCleanup` which of the valid entries are stale, using
 *    `clock.now()` (D-019) — never a bare `new Date()` here.
 * 3. Attempts to delete each stale fork's transcript file, independently (D-022) — see
 *    `deleteOneFork`.
 * 4. Rewrites `forks.json` dropping the entries that no longer need tracking (`deleted` /
 *    `alreadyAbsent`), atomically (`writeFileAtomic`, same as every other write in this project).
 *
 * A fork that isn't stale never has its file touched at all: it doesn't even reach step 3, since
 * `planForkCleanup` never places it in `stale`.
 */
export class DiscoveryForkCleanup implements ForkCleanup {
  constructor(private readonly options: DiscoveryForkCleanupOptions) {}

  async cleanup(forkCleanupDays: number): Promise<ForkCleanupResult> {
    const { claudeHome, seeyaHome, clock } = this.options;
    const { entries, rejected } = await readForkRegistryEntries(seeyaHome);
    const plan = planForkCleanup(entries.map(toForkAge), clock.now(), forkCleanupDays);
    const staleIds = new Set(plan.stale);

    const outcomes = await Promise.all(
      entries
        .filter((entry) => staleIds.has(entry.sessionId))
        .map((entry) => deleteOneFork(claudeHome, entry.sessionId)),
    );

    await dropHandledEntries(seeyaHome, entries, outcomes);

    return { outcomes, rejected: forkRejectionsAsRecords(seeyaHome, rejected) };
  }
}
