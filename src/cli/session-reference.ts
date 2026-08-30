/**
 * Shared `--session <value>` resolution for `end-day-command.ts` and `start-day-selection.ts`
 * (docs/ESPECIFICACAO.md § `seeya end-day`/`seeya start-day`; docs/PLANO-DE-ENTREGA.md S3-T5).
 * Both commands match the same kind of candidate — something with a `sessionId`, a `cwd` and a
 * display `name` — against the same single typed value, and both need the same hard rule: **an
 * ambiguous match is never resolved on this module's own behalf.** `end-day --session` can
 * terminate the process it resolves to (D-002); picking one candidate out of several that all
 * matched would be inventing a choice the evidence doesn't sustain (D-025), in exactly the command
 * where guessing wrong is expensive.
 *
 * Before this task, both commands matched only by exact `sessionId` or exact `cwd` string
 * equality — ambiguity was structurally invisible because `cwd` collisions (dozens of sessions
 * launched from the same directory, the case that motivated S3-T5) simply passed every matching
 * session through in `end-day-command.ts`'s case, or silently returned whichever `Array#find` saw
 * first in `start-day-selection.ts`'s. Both were "choosing wrong is cheap to do by accident";
 * this module is what makes that impossible going forward.
 */
import { normalizeCwdForComparison, type PathPlatformHint } from '../core/cwd-normalization.js';

/** The three fields any `--session` candidate needs, regardless of whether the underlying value is
 * a `DiscoveredSession` (`end-day`) or a `Handoff` (`start-day`) — both already carry all three. */
export interface SessionReference {
  readonly sessionId: string;
  readonly cwd: string;
  readonly name: string;
}

export type SessionReferenceMatch<T> =
  | { readonly kind: 'found'; readonly item: T }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'ambiguous'; readonly matches: readonly T[] };

/** Real environment read once, here, at module scope (not inside `core/`, which cannot read
 * `process.platform` at all — see `core/cwd-normalization.ts`'s own docstring for why the hint is
 * a parameter there). `cli/` is the composition root (D-020); reading the true platform to decide
 * how paths compare is exactly the kind of environment fact only it should resolve. */
const PLATFORM_HINT: PathPlatformHint = process.platform === 'win32' ? 'win32' : 'posix';

function matchesByPrefixNameOrCwd(
  candidateRef: SessionReference,
  value: string,
  normalizedValue: string,
): boolean {
  const prefixMatch = value.length > 0 && candidateRef.sessionId.startsWith(value);
  const nameMatch = candidateRef.name === value;
  const cwdMatch = normalizeCwdForComparison(candidateRef.cwd, PLATFORM_HINT) === normalizedValue;
  return prefixMatch || nameMatch || cwdMatch;
}

/**
 * Resolves `value` against `candidates`, in two stages:
 *
 * 1. **Exact `sessionId`.** D-021 makes `sessionId` the primary identity, and it's the one
 *    real UUID guaranteed unique across `candidates` — a match here is authoritative and never
 *    ambiguous, even if `value` also happens to prefix- or name-match some other candidate.
 * 2. **Everything else, gathered together.** `sessionId` prefix, exact display `name`, and
 *    normalized `cwd` (`core/cwd-normalization.ts`) are evaluated as one combined test per
 *    candidate — not tried one method at a time — because the ambiguity rule cares about how many
 *    DISTINCT candidates matched `value` at all, not which method each one matched through. Zero
 *    is `notFound`; exactly one is `found`; two or more is `ambiguous`, naming every match so the
 *    caller can ask the person to be more specific (e.g. paste the full `sessionId`).
 *
 * @example
 * resolveSessionReference(sessions, toReference, '20632abc') // prefix match
 * resolveSessionReference(sessions, toReference, 'code-6d')  // display-name match
 */
export function resolveSessionReference<T>(
  candidates: readonly T[],
  toReference: (item: T) => SessionReference,
  value: string,
): SessionReferenceMatch<T> {
  const exactSessionIdMatch = candidates.find((item) => toReference(item).sessionId === value);
  if (exactSessionIdMatch !== undefined) {
    return { kind: 'found', item: exactSessionIdMatch };
  }
  const normalizedValue = normalizeCwdForComparison(value, PLATFORM_HINT);
  const matches = candidates.filter((item) =>
    matchesByPrefixNameOrCwd(toReference(item), value, normalizedValue),
  );
  // Destructuring the first two elements (rather than checking `.length` and indexing) is what
  // lets TypeScript narrow `first`/`second` without a non-null assertion under
  // `noUncheckedIndexedAccess` (AGENTS.md: "`!` e `as` ... são sinal de que o tipo está errado").
  const [first, second] = matches;
  if (second !== undefined) {
    return { kind: 'ambiguous', matches };
  }
  return first === undefined ? { kind: 'notFound' } : { kind: 'found', item: first };
}
