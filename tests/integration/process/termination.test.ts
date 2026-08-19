/**
 * `processControl.terminateGracefully` against a real child process
 * (docs/TESTES.md § Integração: "terminar com graça, verificar que morreu ... por plataforma").
 *
 * The two `describe.skipIf` blocks below are not symmetric on purpose. On POSIX this proves
 * gracefulness happened (the child's own SIGTERM handler ran to completion). On Windows it now
 * proves the same thing, by a different mechanism (`CTRL_BREAK_EVENT` via a PowerShell helper,
 * docs/spikes/G-ctrl-break-no-windows.md, S1-T2b) — plus the one case that mechanism genuinely
 * can't reach: a session with no console at all. See
 * `src/adapters/process/termination-windows.ts`'s module comment for what was measured and what
 * wasn't.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processControl } from '../../../src/adapters/process/index.js';
import { spawnInNewConsole } from './_windows-console.js';

const CHILD_SCRIPT = fileURLToPath(
  new URL('../../fixtures/process/graceful-child.mjs', import.meta.url),
);

let spawned: ChildProcess[] = [];
let spawnedPids: number[] = [];
let tempDir: string | undefined;

async function markerPath(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'seeya-process-termination-'));
  return path.join(tempDir, 'marker.txt');
}

/** Companion to `markerPath()`, same temp dir — the file `spawnInNewConsole`-launched fixtures
 * signal readiness through, since that launch mechanism gives no stdout pipe back to the test
 * (see `_windows-console.ts`). Must be called after `markerPath()` in the same test. */
function readyPath(): string {
  if (tempDir === undefined) {
    throw new Error('readyPath() called before markerPath() — no temp dir yet');
  }
  return path.join(tempDir, 'ready.txt');
}

/** Polls for a file to appear, bounded by `timeoutMs`. Test-only wait: `src/` bans this style of
 * polling outside `adapters/clock/` (D-019), but that rule is about product code reading "now"
 * non-deterministically — this is a test fixture readiness gate, same rationale as the existing
 * stdout-based one below. */
async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${filePath} to appear`);
}

/**
 * Spawns the fixture as its own console/process group — matches how a real Claude Code session
 * relates to `seeya` (a pre-existing process `seeya` never spawned itself), and is also what let
 * the Windows measurements in Q-007 send a clean signal without hitting the test's own console.
 * On Windows, `detached: true` means `DETACHED_PROCESS` (D-005): no console at all — which is
 * exactly the scenario the "no console" Windows test below needs.
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
  for (const pid of spawnedPids) {
    try {
      // Not a `ChildProcess` we hold a handle to (`spawnInNewConsole` launches via PowerShell's
      // Start-Process) — `process.kill` on a bare external PID is the only way to reach it, and
      // on Windows any signal name here maps straight to `TerminateProcess` (docs/QUESTOES.md
      // Q-007), which is exactly what test cleanup wants regardless of product-level gracefulness.
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already dead — test cleanup, not product behavior.
    }
  }
  spawnedPids = [];
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
  'terminateGracefully (Windows: CTRL_BREAK_EVENT via console attach — S1-T2b)',
  () => {
    // Generous budget, not a loose one: every step here is a fresh `powershell.exe` process, and
    // `Add-Type` pays a real C#-compile cost each time (no cross-process cache) — measured during
    // development to occasionally exceed vitest's 5s default on a cold run.
    it('the child runs its own shutdown handler to completion before dying', async () => {
      const marker = await markerPath();
      const ready = readyPath();
      // Its own, brand-new console — never this test process's own (see _windows-console.ts
      // for why: the CTRL_BREAK broadcast this test triggers must never reach vitest itself).
      const pid = await spawnInNewConsole(CHILD_SCRIPT, [marker, ready]);
      spawnedPids.push(pid);
      await waitForFile(ready);

      const died = await processControl.terminateGracefully(pid, 5_000);

      expect(died).toBe(true);
      expect(await markerExists(marker)).toBe(true);
      await expect(processControl.isAlive(pid)).resolves.toBe(false);
    }, 15_000);

    it('a session with no console at all cannot be reached, and the answer is an honest false', async () => {
      const marker = await markerPath();
      // detached:true => DETACHED_PROCESS on Windows (D-005): no console to AttachConsole to.
      const child = await spawnDetachedChild(marker);
      const pid = child.pid as number;

      const died = await processControl.terminateGracefully(pid, 2_000);

      // AttachConsole fails (error 6) — nothing was sent, D-002's forced-kill ban leaves
      // nothing else this function may do, so it must report false rather than guess (Q-007).
      expect(died).toBe(false);
      expect(await markerExists(marker)).toBe(false);
      await expect(processControl.isAlive(pid)).resolves.toBe(true);
    }, 10_000);

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
