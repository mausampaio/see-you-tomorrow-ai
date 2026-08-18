/**
 * Single source of truth for the layer matrix in docs/ARQUITETURA.md — 5 layers, 20 ordered
 * pairs, 12 forbidden and 8 allowed (D-020, S0-T6). `layer-matrix.teste.ts` is entirely
 * driven by this structure: none of the 20 pairs is a hand-written `it(...)`.
 *
 * This is a second source of truth, independent of `.dependency-cruiser.cjs` — on purpose. The
 * point of the "guard of the guard" is to confirm the tool's real behavior matches the doc's
 * table; if this file just repeated `.dependency-cruiser.cjs`'s rules, an error made in both
 * places at once would slip through.
 *
 * Not a test file (doesn't end in `.teste.ts`), just the data structure + pure functions that
 * derive the pairs from it.
 */

export interface Layer {
  /** Layer name, matching the directory name under src/. */
  readonly name: string;
  /**
   * Directory (relative to src/) where it's safe to write a fixture file for this layer.
   * `adapters/` has no `index.ts` at its root (each concrete adapter has its own) — that's why
   * it points at a concrete adapter (`adapters/clock/`), like the rest of the suite already
   * does.
   */
  readonly fixtureDir: string;
  /** Directory (relative to src/) whose `index.ts` is this layer's canonical import target. */
  readonly targetDir: string;
}

/**
 * The 5 layers from docs/ARQUITETURA.md. If a new directory shows up in `src/` without entering
 * here (or vice versa), `layer-matrix.teste.ts` fails before it even scans the pairs.
 */
export const LAYERS: readonly Layer[] = [
  { name: 'core', fixtureDir: 'core', targetDir: 'core' },
  { name: 'adapters', fixtureDir: 'adapters/clock', targetDir: 'adapters/clock' },
  { name: 'application', fixtureDir: 'application', targetDir: 'application' },
  { name: 'scheduler', fixtureDir: 'scheduler', targetDir: 'scheduler' },
  { name: 'cli', fixtureDir: 'cli', targetDir: 'cli' },
];

/**
 * ALLOWED pairs of the "From → To" matrix in docs/ARQUITETURA.md, as `"from->to"`. Every pair
 * between two distinct layers not listed here is forbidden. 8 entries — matches the doc table's
 * "8 allowed" (see the sanity test in layer-matrix.teste.ts).
 */
const ALLOWED_PAIRS: ReadonlySet<string> = new Set([
  'adapters->core',
  'application->core',
  'scheduler->core',
  'scheduler->application',
  'cli->core',
  'cli->adapters',
  'cli->application',
  'cli->scheduler',
]);

export interface LayerPair {
  readonly from: Layer;
  readonly to: Layer;
  readonly allowed: boolean;
}

/** The 20 ordered pairs (5 layers × 4, excluding the diagonal) derived from LAYERS + ALLOWED_PAIRS. */
export function orderedPairs(): LayerPair[] {
  const pairs: LayerPair[] = [];
  for (const from of LAYERS) {
    for (const to of LAYERS) {
      if (from.name === to.name) {
        continue;
      }
      pairs.push({ from, to, allowed: ALLOWED_PAIRS.has(`${from.name}->${to.name}`) });
    }
  }
  return pairs;
}
