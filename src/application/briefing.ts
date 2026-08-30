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
import type { Day } from '../core/types.js';

/**
 * Reads back every handoff saved for `day`, renders the consolidated markdown, and persists it as
 * `~/.seeya/days/<day>/summary.md`. Never throws over a corrupted individual handoff file (D-022:
 * `Storage#listHandoffs` already isolates that per file) — only a failure of the listing or the
 * write itself propagates, same as any other storage I/O in this use case.
 *
 * @example
 * await writeDailyBriefing(deps.storage, day, now);
 */
export async function writeDailyBriefing(storage: Storage, day: Day, now: Date): Promise<void> {
  const { handoffs, rejected } = await storage.listHandoffs(day);
  const markdown = generateBriefingMarkdown(day, now, handoffs, rejected);
  await storage.saveBriefing(day, markdown);
}
