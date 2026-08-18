/**
 * Pure comparison of "evidence signature" — what eligibility's anti-duplication uses (D-026,
 * `core/eligibility.ts`).
 */

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
