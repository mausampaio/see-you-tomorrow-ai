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
    // ESRCH ('no such process') is unit-testable for real: any impossible/already-dead PID
    // reliably produces it, on every platform (see tests/integration/process). The EPERM/unknown
    // fallthrough below ('alive' for EPERM, pitfall 2; rethrows for anything else, see
    // interpretExistenceCheckError) is a different story: that logic is fully unit-tested with a
    // FABRICATED error in liveness.test.ts, but reaching it through a REAL `process.kill(pid, 0)`
    // needs a PID the test runner has no permission to signal. Reproducible on Windows (PID 4,
    // "System", measured — see liveness.ts's module comment) but not portably: `npm run
    // verificar:linux` runs as root inside `node:22-bookworm` (scripts/verificar-linux.mjs), and
    // root can signal any PID, so no process is ever permission-denied there — the same call
    // would just succeed instead of throwing. A test hard-coded to one platform's protected PID
    // would be exactly the instability AGENTS.md's F.I.R.S.T. rule warns against, not a
    // guardrail. Excluded from coverage below (branch AND the fallthrough statement) for that
    // reason, not because it's untested — the logic is, the real syscall path isn't reachable.
    // v8 ignore else
    if (errorCode(error) === 'ESRCH') {
      return Promise.resolve(false);
    }
    /* v8 ignore next -- the statement itself, not just the branch above; see the comment above
       the `if` for why this line's own real-syscall path can't be portably exercised. */
    return Promise.resolve(interpretExistenceCheckError(error) === 'alive');
  }
}
