/**
 * A short, human-readable stand-in for a full `sessionId` UUID, for `seeya sessions`
 * (docs/PLANO-DE-ENTREGA.md S3-T5). The maintainer launches Claude Code from a single directory
 * for dozens of sessions in the same working day; `cwd` and the auto-generated display `name`
 * (`nameSource: "derived"`, e.g. `"code-6d"`) already usually differ per session, but the listing
 * carried nothing that let a person point at one specific session to feed back into `--session`.
 * This is display only — `cli/session-reference.ts` matches `--session` against the FULL
 * `sessionId`, an explicit prefix the user types, or the display name, never against this
 * shortened form specifically.
 *
 * **Why 8 characters, and why "provavelmente melhor de ler que um UUID inteiro" doesn't mean
 * "pretend collisions can't happen".** A `sessionId` is a UUID
 * (docs/ESPECIFICACAO.md's glossary), and 8 hex characters is exactly its first hyphen-delimited
 * group — 32 bits, effectively random for a v4 UUID. For N sessions in one listing, the chance ANY
 * two share that first group is approximately N²/2^33 (birthday bound): for the "dozens" the
 * maintainer described (say 40), that's roughly 1.9e-7 — small, but this module never treats
 * "small" as "zero". `computeDisplaySessionIds` below escalates to the next UUID group boundary
 * for exactly the ids that collide, and all the way to the full id if even that isn't enough —
 * the same "handle it, don't hope around it" spirit as D-025, applied to a probability instead of
 * a missing fact.
 */
const UUID_GROUP_BOUNDARIES = [8, 13, 18, 23, 36] as const;

function uniquePrefixesAtLength(
  ids: readonly string[],
  length: number,
): { readonly resolved: ReadonlyMap<string, string>; readonly stillColliding: string[] } {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const prefix = id.slice(0, length);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  const resolved = new Map<string, string>();
  const stillColliding: string[] = [];
  for (const id of ids) {
    const prefix = id.slice(0, length);
    if (counts.get(prefix) === 1) {
      resolved.set(id, prefix);
    } else {
      stillColliding.push(id);
    }
  }
  return { resolved, stillColliding };
}

/**
 * Assigns each `sessionId` the shortest UUID-group-aligned prefix that, within THIS batch, no
 * other id shares — escalating to the next group boundary only for the ids actually involved in a
 * collision. Recomputed fresh from whatever `DiscoveredSession.sessionId`s exist on each
 * `seeya sessions` run; nothing here promises the same session keeps the same short id across two
 * different runs.
 *
 * @example
 * computeDisplaySessionIds(['a1b2c3d4-...', 'ffeeddcc-...'])
 * // Map { 'a1b2c3d4-...' => 'a1b2c3d4', 'ffeeddcc-...' => 'ffeeddcc' }
 */
export function computeDisplaySessionIds(
  sessionIds: readonly string[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  let pending = [...new Set(sessionIds)];
  for (const length of UUID_GROUP_BOUNDARIES) {
    if (pending.length === 0) {
      break;
    }
    const { resolved, stillColliding } = uniquePrefixesAtLength(pending, length);
    for (const [id, prefix] of resolved) {
      result.set(id, prefix);
    }
    pending = stillColliding;
  }
  // A real sessionId is exactly 36 characters, so two DISTINCT UUIDs can never reach here still
  // colliding — the last boundary (36) is the whole string, and two different strings can't share
  // their whole selves. This only fires for malformed, longer-than-a-UUID values that happen to
  // share every character up to position 36; falling back to each one's own full (differing)
  // string is what keeps them distinguishable instead of silently picking one arbitrary label for
  // both (D-025's spirit: never assume more than the evidence — here, the boundary table — proves).
  for (const id of pending) {
    result.set(id, id);
  }
  return result;
}
