/**
 * `endDay`'s step 3 (docs/ESPECIFICACAO.md § `seeya end-day`: "Grava o briefing do dia
 * consolidando todos os handoffs") — S2-T4. Rereads every handoff persisted for `day` from
 * `Storage` (not just the ones this particular `endDay` run just captured) so the briefing stays
 * consolidated across multiple runs the same day, e.g. `seeya end-day --session <id>` (S2-T5) run
 * more than once. The actual rendering is `core/briefing.ts#generateBriefingMarkdown`, a pure
 * function; this module is the thin I/O shell around it (`application/` orchestrates, `core/`
 * decides what the text says).
 */
import { generateBriefingMarkdown } from '../core/briefing.js';
import type { Storage } from '../core/ports.js';
import type { Day, EndDayScope, Handoff, SessionListing } from '../core/types.js';

/**
 * Reads back every handoff saved for `day`, renders the consolidated markdown, and persists it as
 * `~/.seeya/days/<day>/summary.md`. Never throws over a corrupted individual handoff file (D-022:
 * `Storage#listHandoffs` already isolates that per file) — only a failure of the listing or the
 * write itself propagates, same as any other storage I/O in this use case.
 *
 * `listedSessions` (D-031) is THIS run's own fresh discovery, not persisted anywhere: unlike
 * handoffs, a listed session was never captured, so there is nothing for `Storage` to have on disk
 * for a previous run to merge back in — the section simply reflects who was out of scope as of the
 * most recent `seeya end-day` run, the same way `seeya sessions` would if run again right now.
 *
 * `scope` (S4-T0c) is THIS call's own `EndDayScope`, passed straight through to
 * `generateBriefingMarkdown` — same "not persisted, always the latest run's own view" reasoning as
 * `listedSessions` just above, not derived from `handoffs` (which can span several earlier runs).
 *
 * @example
 * await writeDailyBriefing(deps.storage, day, now, listedSessions, scope);
 */
export async function writeDailyBriefing(
  storage: Storage,
  day: Day,
  now: Date,
  listedSessions: readonly SessionListing[] = [],
  scope: EndDayScope = { kind: 'fullDay' },
): Promise<void> {
  const { handoffs, rejected } = await storage.listHandoffs(day);
  const markdown = generateBriefingMarkdown(day, now, handoffs, rejected, listedSessions, scope);
  await storage.saveBriefing(day, markdown);
}

/** By `sessionId`, `fresh` entries winning over `persisted` ones — the same "last write wins"
 * outcome a real second `saveHandoff` for the same session would produce on disk, applied here
 * only in memory. */
function mergeHandoffsBySessionId(
  persisted: readonly Handoff[],
  fresh: readonly Handoff[],
): Handoff[] {
  const bySessionId = new Map(persisted.map((handoff) => [handoff.sessionId, handoff]));
  for (const handoff of fresh) {
    bySessionId.set(handoff.sessionId, handoff);
  }
  return [...bySessionId.values()];
}

/**
 * `--dry-run`'s (S2-T5) non-writing counterpart to `writeDailyBriefing` above: renders the SAME
 * markdown a real run would, without ever calling `storage.saveBriefing`. `freshHandoffs` are this
 * dry run's own just-built (never persisted) captures — merged with whatever `storage.listHandoffs`
 * already has on disk for `day` so the preview stays honest about a day that had a real
 * `seeya end-day --session <id>` run earlier and a `--dry-run` preview of a DIFFERENT session
 * later: the preview shows both, matching what a real run would consolidate.
 *
 * @example
 * const markdown = await previewDailyBriefing(deps.storage, day, now, capturedHandoffs, listed, scope);
 * // markdown is what ~/.seeya/days/<day>/summary.md WOULD contain — nothing was written.
 */
export async function previewDailyBriefing(
  storage: Storage,
  day: Day,
  now: Date,
  freshHandoffs: readonly Handoff[],
  listedSessions: readonly SessionListing[] = [],
  scope: EndDayScope = { kind: 'fullDay' },
): Promise<string> {
  const { handoffs, rejected } = await storage.listHandoffs(day);
  const merged = mergeHandoffsBySessionId(handoffs, freshHandoffs);
  return generateBriefingMarkdown(day, now, merged, rejected, listedSessions, scope);
}
