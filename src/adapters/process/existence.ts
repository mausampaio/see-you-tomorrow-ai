/**
 * The one real OS call shared by `isAlive` and `terminateGracefully`: "does a process with this
 * PID exist right now". Cross-platform via Node's own `process.kill(pid, 0)` — sending signal 0
 * never actually signals anything, POSIX defines it as a pure existence/permission probe, and
 * Node's Windows emulation (confirmed here — see `interpretExistenceCheckError` in `liveness.ts`
 * for the measurements) maps it to the same `ESRCH`/`EPERM` pair as real POSIX systems.
 */
import { errorCode, interpretExistenceCheckError } from './liveness.js';

/**
 * `pid <= 0` has special, non-per-process meaning to POSIX `kill()` (0 or negative signals a whole
 * process group). `DiscoveredSession.pid` is always a positive int by the time it reaches here
 * (`adapters/discovery/schemas.ts`), so a non-positive value here means a caller bug, not a
 * process to check — fail loudly rather than silently broadcasting a signal to a process group
 * nobody asked to reach.
 */
function assertValidPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new RangeError(`pid must be a positive integer, got ${pid}`);
  }
}

/** True if a process with this PID exists right now, false if it doesn't. Never guesses on an
 * error code it doesn't recognize — see `interpretExistenceCheckError`. */
export function processExists(pid: number): Promise<boolean> {
  assertValidPid(pid);
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch (error) {
    if (errorCode(error) === 'ESRCH') {
      return Promise.resolve(false);
    }
    // 'alive' for EPERM (pitfall 2); throws for anything else (interpretExistenceCheckError).
    return Promise.resolve(interpretExistenceCheckError(error) === 'alive');
  }
}
