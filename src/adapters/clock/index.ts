/**
 * Clock adapter: the project's single source of "now", implements the `Clock` port
 * (`core/ports.ts`, D-019). This is the only module in the project allowed to call `new Date()`
 * with no argument — `no-restricted-syntax` in `eslint.config.js` enforces that everywhere else,
 * and `dependency-cruiser`/the layer matrix don't need a rule here because there's nothing to
 * compose: `systemClock` has no constructor arguments and no state, so `cli/` (the composition
 * root, D-020) can hand the same value to every port that needs a `Clock`.
 *
 * Read once per call, never cached: two calls a moment apart are meant to observe two different
 * instants (docs/ARQUITETURA.md § `clock/`: "um único módulo produz `now()`").
 */
import type { Clock } from '../../core/ports.js';

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  },
};
