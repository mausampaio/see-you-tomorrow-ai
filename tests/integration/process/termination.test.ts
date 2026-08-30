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
    // Budget history (S1-T13, docs/PLANO-DE-ENTREGA.md): this test used to carry a 15s budget on
    // the theory that `Add-Type`'s per-process C#-compile cost (no cross-process cache) was what
    // occasionally pushed it past vitest's 5s default under full-suite load. That theory was
    // measured and found wrong: `Add-Type` alone costs 200-350ms. The actual cost was
    // `sendCtrlBreak` blocking on its own helper process's `close` event even after the helper's
    // answer was already in hand — see `console-signal.ts`'s `runSendScript` doc comment for the
    // ~5.5s of dead air that was actually going on and the fix (resolve on the stdout outcome
    // word, don't wait for the OS to finish tearing the helper down). Post-fix, measured running
    // the full `unit`+`integration`+`guards` suite with coverage (`npm run cobertura`) three times
    // in a row on this machine: 3891ms, 3149ms, 4115ms for this test alone. S1-T13 set the budget
    // to 10s from THAT measurement — a dev machine, suite at ~290 tests — and it was never
    // re-checked against the CI runner, which is what actually gates the portão (S2-T8).
    //
    // S2-T8 measurement, on the real runner: GitHub Actions `windows-latest`, draft PR #1, run
    // 33314352147, two separate job attempts, `--reporter=verbose` — AFTER fixing the two
    // cold-start costs that were contaminating this file's numbers on a fresh VM
    // (`_windows-shim-global-setup.ts`, `_powershell-warmup-global-setup.ts`; this test's own
    // `console-signal.ts` path spawns `powershell.exe` too). This test alone: 1870ms and 1511ms.
    // The sibling test below: 640ms and 524ms. Both comfortably below their own internal
    // `terminateGracefully` budget (5s here, 2s below) — the child shuts down long before either
    // deadline, on this measurement.
    //
    // The budget picked isn't "worst observed times a factor" — it's the internal budget passed
    // to `terminateGracefully` PLUS a fixed 3s of slack (same shape of relationship S2-T7 uses for
    // the guards' child-process budget): if the child were ever slow enough to make
    // `terminateGracefully` actually wait out its own internal allowance, the outer test still
    // needs room to receive that answer and run its assertions, or the test framework's own
    // timeout fires first and destroys the diagnosis (the exact failure mode S2-T7 was about).
    // 5_000 (internal) + 3_000 (slack) = 8_000.
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
    }, 8_000);

    // Same reasoning as above, sized to THIS test's own internal budget (2s, not 5s) — see the
    // comment on the sibling test for the measurement and the "internal budget + 3s slack" shape.
    // Deliberately NOT the same number as the sibling: S2-T7 already spent one task on the mistake
    // of one shared budget serving two different operations. 2_000 (internal) + 3_000 (slack) =
    // 5_000. Measured on the same runner/run as above: 640ms and 524ms.
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
    }, 5_000);

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
