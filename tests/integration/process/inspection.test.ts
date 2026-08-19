/**
 * `readCwd`/`readCommandLine` against a real process (docs/TESTES.md § Integração; D-023/S1-T10).
 * Same fixture and cleanup discipline as tests/integration/process/liveness.test.ts: every spawned
 * child is force-killed in `afterEach`, even when an assertion throws.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommandLine, readCwd } from '../../../src/adapters/process/inspection.js';

const CHILD_SCRIPT = fileURLToPath(
  new URL('../../fixtures/process/graceful-child.mjs', import.meta.url),
);

let spawned: ChildProcess[] = [];
let workDir: string | undefined;

afterEach(async () => {
  for (const child of spawned) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead — fine, this is test cleanup, not the product's own termination policy.
    }
  }
  spawned = [];
  if (workDir !== undefined) {
    // maxRetries/retryDelay: Windows can keep a directory locked for a moment after the process
    // whose cwd it was gets SIGKILL'd but hasn't finished tearing down yet (EBUSY) — Node's own
    // retry knobs for exactly this case, cheaper than this test tracking process exit itself.
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    workDir = undefined;
  }
});

/** Spawns the trivial fixture with a real, dedicated `cwd` — not this test runner's own cwd, so a
 * pass here proves the read is real rather than coincidentally matching. */
async function spawnChildWithKnownCwd(): Promise<{ pid: number; cwd: string }> {
  workDir = await mkdtemp(path.join(tmpdir(), 'seeya-inspection-'));
  const child = spawn(process.execPath, [CHILD_SCRIPT, ''], { cwd: workDir, stdio: 'ignore' });
  spawned.push(child);
  // The value the OS itself will report back — realpath resolves any symlink in the tmpdir root
  // (e.g. macOS's /tmp -> /private/tmp) the same way /proc/<pid>/cwd already does.
  const realCwd = await realpath(workDir);
  return { pid: child.pid as number, cwd: realCwd };
}

describe('readCwd', () => {
  it('reads the real cwd of a live child process (Linux/macOS) or null (Windows, D-023)', async () => {
    const { pid, cwd } = await spawnChildWithKnownCwd();

    const result = await readCwd(pid);

    if (process.platform === 'win32') {
      // D-023, measured: no cwd for an arbitrary PID on Windows without native code.
      expect(result).toBeNull();
    } else {
      expect(result).toBe(cwd);
    }
  });

  it('a pid with no such process resolves to null, not a throw', async () => {
    const IMPOSSIBLE_PID = 999_999_999;

    await expect(readCwd(IMPOSSIBLE_PID)).resolves.toBeNull();
  });
});

describe('readCommandLine', () => {
  it('reads a real command line containing this fixture script (Linux/macOS) or null (Windows)', async () => {
    const { pid } = await spawnChildWithKnownCwd();

    const result = await readCommandLine(pid);

    if (process.platform === 'win32') {
      expect(result).toBeNull();
    } else {
      expect(result).toContain('graceful-child.mjs');
    }
  });

  it('a pid with no such process resolves to null, not a throw', async () => {
    const IMPOSSIBLE_PID = 999_999_999;

    await expect(readCommandLine(IMPOSSIBLE_PID)).resolves.toBeNull();
  });
});
