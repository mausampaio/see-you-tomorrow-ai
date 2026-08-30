/**
 * Bounded concurrency for `endDay`'s per-session pipeline (docs/PLANO-DE-ENTREGA.md S2-T3:
 * "concorrência limitada" — `captureConcurrency` from `config.json`, default 3). Generic and
 * side-effect-free on its own: it only schedules calls to `task`, never decides what a session
 * pipeline does or how its failures are handled (that's `capture-session.ts`'s job — this module
 * doesn't even know what a session is).
 *
 * No new dependency (`p-limit` and similar exist, but AGENTS.md requires asking before adding
 * one, and the whole mechanism is a dozen lines): a fixed-size pool of `limit` workers, each
 * pulling the next index off a shared cursor until the queue is empty.
 */

/**
 * Runs `task` once per item in `items`, at most `limit` calls in flight at a time, and returns the
 * results in the SAME order as `items` — never the order calls happened to settle in, so a caller
 * can zip `results[i]` back to `items[i]` without carrying the index through `task` itself.
 *
 * `limit <= 0` would start zero workers and hang forever awaiting results that never come; treated
 * as `1` instead (AGENTS.md § "Dados de fora": `captureConcurrency` is already validated
 * `int().positive()` in `config-schema.ts`, so this only guards a caller that bypasses config
 * entirely, e.g. a test — silently doing the least-surprising sane thing beats hanging or
 * throwing for a value this cheap to make safe).
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  // A shared iterator, not a shared index counter with `items[nextIndex]`: with
  // `noUncheckedIndexedAccess` on, indexing would type as `T | undefined` and need a cast
  // (AGENTS.md: `as` in production code is a sign the type is wrong) — `entries()` hands each
  // worker an already-paired `[index, item]` with no such gap. Safe to share across concurrent
  // `worker()` calls: `.next()` runs synchronously, and JS has no thread interleaving mid-call.
  const iterator = items.entries();

  async function worker(): Promise<void> {
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      const [index, item] = next.value;
      results[index] = await task(item, index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}
