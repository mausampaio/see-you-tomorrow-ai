import { describe, expect, it } from 'vitest';
import { processExists } from '../../../../src/adapters/process/existence.js';

/**
 * `processExists`'s `assertValidPid` guard (S1-T12, found while auditing `adapters/process`'s
 * coverage: this file had zero direct tests before this — only exercised indirectly through
 * `isAlive`/`terminateGracefully` integration tests, which always pass a real, valid PID).
 *
 * `processExists` is deliberately NOT `async`: the guard throws synchronously, before any
 * `Promise` is created, so a bad PID surfaces as an immediate throw rather than a rejection one
 * microtask later — `expect(() => ...).toThrow(...)`, not `.rejects`.
 */
describe('processExists — assertValidPid guard', () => {
  it('rejects a non-positive pid (0 or negative) — POSIX kill() treats those as a process GROUP', () => {
    expect(() => processExists(0)).toThrow(/pid must be a positive integer, got 0/);
    expect(() => processExists(-1)).toThrow(/pid must be a positive integer, got -1/);
  });

  it('rejects a non-integer pid — never silently truncated before reaching process.kill', () => {
    expect(() => processExists(1.5)).toThrow(/pid must be a positive integer, got 1\.5/);
  });

  it('the error names the offending value and the expected shape (AGENTS.md error-message rule)', () => {
    expect(() => processExists(-7)).toThrow(RangeError);
  });
});
