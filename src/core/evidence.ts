/**
 * Pure comparison of "evidence signature" — what eligibility's anti-duplication uses (D-026,
 * `core/eligibility.ts`) — plus the pure function that builds one from `HandoffFacts`
 * (`application/endDay`, S2-T3).
 */
import type { GitFacts, HandoffFacts } from './types.js';

/**
 * A comparable token per evidence source (D-013: git, transcript, registry). `null` when that
 * source didn't answer at that moment. The shape of each token (ISO date, commit sha, state
 * hash) is decided by whoever assembles the signature — outside the core, because it depends on
 * sources that don't exist here yet (git only arrives in S2-T1) or on I/O (transcript mtime).
 * This type only declares the shape the pure comparison needs: a map from source name to token.
 */
export type EvidenceSignature = Readonly<Record<string, string | null>>;

/**
 * Do two signatures represent the same evidence? Used by anti-duplication (D-026): a session is
 * only "duplicate" when **no** source has changed since today's last capture.
 *
 * Rule per source, key by key, over the union of keys present in both signatures:
 * - Both absent (`null` on both sides) — that source decides nothing; the judgment passes to the
 *   others (same principle as D-025: absence of data doesn't become a positive claim — applied
 *   here per source, not to the whole signature).
 * - One value present and the other absent, or both present but different — the source changed:
 *   the whole signature is already not the same, no need to look at the remaining keys.
 * - Both present and equal — that source confirms nothing changed.
 *
 * **Result is only `true` with at least one source positively confirming.** If every comparable
 * source is absent on both sides (nothing to compare), the result is `false` — same reason as
 * D-025: no domain rule converts "I don't know" into "yes, it's the same".
 */
export function sameEvidence(previous: EvidenceSignature, current: EvidenceSignature): boolean {
  const sources = new Set([...Object.keys(previous), ...Object.keys(current)]);
  let hasConfirmingSource = false;

  for (const source of sources) {
    const previousValue = previous[source] ?? null;
    const currentValue = current[source] ?? null;

    if (previousValue === null && currentValue === null) {
      continue;
    }

    if (previousValue !== currentValue) {
      return false;
    }

    hasConfirmingSource = true;
  }

  return hasConfirmingSource;
}

/**
 * A stable text token for `git`, or `null` when there's no repository at all (`HandoffFacts.git
 * === null`) — kept as its own `null`, never coerced into a string that would read as "a repo with
 * nothing going on" (D-025, same distinction `GitReadResult` draws in `core/ports.ts`).
 *
 * `JSON.stringify` over a fixed field order is enough for a *comparison* token — it doesn't need
 * to be a canonical/minimal encoding, only to change whenever the underlying facts do. The one
 * known source of a false "changed" reading is git returning worktrees/modifiedFiles in a
 * different order between two reads of an UNCHANGED tree; that only ever produces an unnecessary
 * re-capture (safe: same direction D-025 already prefers, "say less than you might get away with"
 * — never a false "unchanged" that would hide the autonomous-agent case D-026 exists for).
 */
function gitToken(git: GitFacts | null): string | null {
  if (git === null) {
    return null;
  }
  return JSON.stringify({
    branch: git.branch,
    dirty: git.dirty,
    modifiedFiles: git.modifiedFiles,
    commitsToday: git.commitsToday,
    worktrees: git.worktrees,
  });
}

/**
 * Builds the `EvidenceSignature` D-026's anti-duplication compares — one token per source, from
 * the same `HandoffFacts` a handoff itself persists (`core/types.ts`). Deliberately covers only
 * `transcript` and `git`: D-026's own text names exactly these two ("última atividade do
 * transcript quando existe, e o estado do git"), never `registry` — a live session's registry
 * facts (`cwd`, `name`, start time) don't change over the course of a day the way transcript
 * activity or a git tree do, so there is no meaningful "changed since this morning" signal to
 * compare there.
 *
 * Called on both sides of a comparison: on freshly gathered facts (`currentSignature`) and, by
 * reading a previous handoff's own persisted `facts` back through this same function, on
 * `previousCaptureToday.signature` — no separate "signature" field is persisted in the handoff
 * document at all (docs/ESPECIFICACAO.md's "Formato do handoff" doesn't show one, and D-026 left
 * the exact format to whoever implemented S2-T3); reconstructing it from `facts` avoids inventing
 * a disk key the spec doesn't already have.
 *
 * @example
 * const signature = buildEvidenceSignature(handoff.facts); // { transcript: "...", git: "..." }
 */
export function buildEvidenceSignature(facts: HandoffFacts): EvidenceSignature {
  return {
    transcript: facts.lastActivity === null ? null : facts.lastActivity.toISOString(),
    git: gitToken(facts.git),
  };
}
