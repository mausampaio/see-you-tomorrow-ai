/**
 * `adapters/process` against real processes (docs/TESTES.md § Integração: "iniciar um processo
 * filho trivial, verificar liveness ... por plataforma"). Every spawned child is force-killed in
 * `afterEach`, even when an assertion throws, so a failing test never leaves a stray process on
 * the machine running it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processControl } from '../../../src/adapters/process/index.js';
import { captureObservedProcStart } from '../../../src/adapters/process/proc-start.js';
import { processExists } from '../../../src/adapters/process/existence.js';

const CHILD_SCRIPT = fileURLToPath(
  new URL('../../fixtures/process/graceful-child.mjs', import.meta.url),
);

let spawned: ChildProcess[] = [];

function spawnTrivialChild(markerPath = ''): ChildProcess {
  const child = spawn(process.execPath, [CHILD_SCRIPT, markerPath], { stdio: 'ignore' });
  spawned.push(child);
  return child;
}

/** Real recheck via our own adapter — used to capture the live child's actual procStart. */
async function readRealProcStart(pid: number): Promise<string> {
  const capture = await captureObservedProcStart(pid, processExists);
  if (capture.kind !== 'value') {
    throw new Error(`expected a real procStart capture, got ${JSON.stringify(capture)}`);
  }
  return capture.value;
}

afterEach(() => {
  for (const child of spawned) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead — fine, this is test cleanup, not the product's own termination policy.
    }
  }
  spawned = [];
});

describe('processControl.isAlive', () => {
  it('a freshly spawned process is alive (no procStart tie-break requested)', async () => {
    const child = spawnTrivialChild();
    await expect(processControl.isAlive(child.pid as number)).resolves.toBe(true);
  });

  it('a process that has exited is not alive', async () => {
    const child = spawnTrivialChild();
    const pid = child.pid as number;
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    await expect(processControl.isAlive(pid)).resolves.toBe(false);
  });

  it("this platform's real procStart capture round-trips: isAlive(pid, itsOwnValue) is true", async () => {
    const child = spawnTrivialChild();
    const pid = child.pid as number;
    const realValue = await readRealProcStart(pid);

    await expect(processControl.isAlive(pid, realValue)).resolves.toBe(true);
  });

  /**
   * Aceite item 3, exercised end-to-end for real (rather than only via the unit test of
   * `resolveIsAlive`): the process really is alive, and its real procStart really is captured —
   * but the caller-supplied value doesn't match, exactly the shape of a stale registry entry
   * whose PID got recycled by the OS. `isAlive` must say `false`, not "alive because the PID
   * exists".
   */
  it('a live PID with a genuinely divergent procStart is reported not-alive (recycled-PID shape)', async () => {
    const child = spawnTrivialChild();
    const pid = child.pid as number;
    const wrongProcStart = 'this-will-never-equal-a-real-capture';

    await expect(processControl.isAlive(pid, wrongProcStart)).resolves.toBe(false);
  });

  it("the captured procStart matches this platform's documented shape", async () => {
    const child = spawnTrivialChild();
    const pid = child.pid as number;
    const value = await readRealProcStart(pid);

    if (process.platform === 'darwin') {
      expect(value.length).toBeGreaterThan(0);
    } else {
      // Linux and Windows: digits-only, per docs/spikes/F-procstart-por-so.md.
      expect(value).toMatch(/^\d+$/);
    }
  });
});
