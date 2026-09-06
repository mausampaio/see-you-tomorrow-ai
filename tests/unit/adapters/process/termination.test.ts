/**
 * `terminateAbruptly` (S4-T5, `adapters/process/termination.ts`) — the error-interpretation half
 * that doesn't need a real process (docs/TESTES.md § Unidade's own convention for this directory,
 * `liveness.test.ts`: fabricated inputs, no real OS call). The two paths that DO need a real
 * process — actually killing something, and tolerating an already-dead pid for real — are covered
 * by `tests/integration/process/termination.test.ts` instead.
 *
 * `process.kill` itself is mocked here (`vi.spyOn`) rather than fabricated through an injected
 * port: this function is intentionally NOT part of `ProcessControl` (see its own docstring — it
 * exists only for `cli/daemon-command.ts` to end `seeya`'s own daemon, never a discovered
 * session), so there is no port to inject a double through in the first place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminateAbruptly } from '../../../../src/adapters/process/termination.js';

describe('terminateAbruptly', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tolerates ESRCH (already dead) without rejecting', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });

    await expect(terminateAbruptly(999_999)).resolves.toBeUndefined();
  });

  it("rethrows any other error — guessing success on an unrecognized failure is not this function's call to make", async () => {
    const original = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw original;
    });

    await expect(terminateAbruptly(999_999)).rejects.toBe(original);
  });

  it('wraps a non-Error throw in a real Error rather than rejecting with a bare string/object', async () => {
    // Exercises the "error instanceof Error" fallback against a thrown value that isn't one.
    vi.spyOn(process, 'kill').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'not an Error instance';
    });

    await expect(terminateAbruptly(999_999)).rejects.toThrow('not an Error instance');
  });
});
