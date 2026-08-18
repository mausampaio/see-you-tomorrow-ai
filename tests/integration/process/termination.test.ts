/**
 * `processControl.terminateGracefully` against a real child process
 * (docs/TESTES.md § Integração: "terminar com graça, verificar que morreu ... por plataforma").
 *
 * The two `describe.skipIf` blocks below are not symmetric on purpose. On POSIX this proves
 * gracefulness happened (the child's own SIGTERM handler ran to completion). On Windows it proves
 * the opposite, deliberately: no dependency-free graceful mechanism was found for a PID `seeya`
 * didn't spawn itself (see `src/adapters/process/termination.ts` and docs/QUESTOES.md Q-007 for
 * the measurements), and D-002 forbids a forced kill in v1 — so the correct, honest behavior is to
 * leave the process untouched and report `false`. This test is the evidence
 * docs/PLANO-DE-ENTREGA.md S1-T2 asks for in place of a "graceful termination worked" test, for
 * the platform where none is possible without a new native dependency.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processControl } from '../../../src/adapters/process/index.js';

const CHILD_SCRIPT = fileURLToPath(
  new URL('../../fixtures/process/graceful-child.mjs', import.meta.url),
);

let spawned: ChildProcess[] = [];
let tempDir: string | undefined;

async function markerPath(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'seeya-process-termination-'));
  return path.join(tempDir, 'marker.txt');
}

/**
 * Spawns the fixture as its own console/process group — matches how a real Claude Code session
 * relates to `seeya` (a pre-existing process `seeya` never spawned itself), and is also what let
 * the Windows measurements in Q-007 send a clean signal without hitting the test's own console.
 *
 * Waits for the fixture's own "ready" line before returning: sending a signal right after
 * `spawn()` resolves can race the child's startup and hit it before its handler is registered —
 * reproduced for real on the Linux CI container, not a hypothetical.
 */
function spawnDetachedChild(marker: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [CHILD_SCRIPT, marker], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  spawned.push(child);
  return new Promise((resolve) => {
    child.stdout.once('data', () => resolve(child));
  });
}

async function markerExists(marker: string): Promise<boolean> {
  return readFile(marker, 'utf8').then(
    () => true,
    () => false,
  );
}

afterEach(async () => {
  for (const child of spawned) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead — test cleanup, not product behavior.
    }
  }
  spawned = [];
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe.skipIf(process.platform === 'win32')('terminateGracefully (POSIX: real SIGTERM)', () => {
  it('the child runs its own shutdown handler to completion before dying', async () => {
    const marker = await markerPath();
    const child = await spawnDetachedChild(marker);
    const pid = child.pid as number;

    const died = await processControl.terminateGracefully(pid, 5_000);

    expect(died).toBe(true);
    expect(await markerExists(marker)).toBe(true);
    await expect(processControl.isAlive(pid)).resolves.toBe(false);
  });

  it('a process that is already dead is reported terminated without error', async () => {
    const marker = await markerPath();
    const child = await spawnDetachedChild(marker);
    const pid = child.pid as number;
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    await expect(processControl.terminateGracefully(pid, 1_000)).resolves.toBe(true);
  });
});

describe.skipIf(process.platform !== 'win32')(
  'terminateGracefully (Windows: no dependency-free graceful mechanism — Q-007)',
  () => {
    it('never runs the child shutdown handler, never forces a kill, and reports false', async () => {
      const marker = await markerPath();
      const child = await spawnDetachedChild(marker);
      const pid = child.pid as number;

      const died = await processControl.terminateGracefully(pid, 2_000);

      // D-002 bans a forced kill in v1: with no graceful path available, this must be a no-op.
      expect(died).toBe(false);
      expect(await markerExists(marker)).toBe(false);
      await expect(processControl.isAlive(pid)).resolves.toBe(true);
    });

    it('reports true when the process already happens to be dead — that much is still honest', async () => {
      const marker = await markerPath();
      const child = await spawnDetachedChild(marker);
      const pid = child.pid as number;
      child.kill(); // test-only forced cleanup; not the product's own termination path
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));

      await expect(processControl.terminateGracefully(pid, 1_000)).resolves.toBe(true);
    });
  },
);
