import type { Clock } from '../../../src/core/ports.js';

/**
 * Named double for `Clock` (docs/TESTES.md § Testes: "duplo de I/O é classe/objeto nomeado
 * implementando a porta, não stub inline"). Fixed instant, set once at construction — no test
 * in this suite needs the instant to change mid-test.
 */
export class FakeClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return this.instant;
  }

  /** No test in this suite waits on the daemon's poll cadence — resolves immediately. */
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}
