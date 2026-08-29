/**
 * Proves docs/ARQUITETURA.md's atomic-write claim by execution, not by trusting the
 * temp-then-rename pattern's reputation (docs/PLANO-DE-ENTREGA.md S1-T5's explicit ask, and
 * docs/TESTES.md § "storage/": "matar no meio da escrita não pode deixar arquivo pela metade").
 * Kills a REAL child process partway through writing, then inspects what's actually on disk. An
 * in-process unit test calling `writeFileAtomic` and throwing an exception can't reproduce this —
 * nothing short of an actual OS-level kill exercises the failure mode this guards against (the
 * process disappearing between "temp file has some bytes" and "rename has happened").
 *
 * tests/fixtures/storage/slow-atomic-write.mjs is a standalone reimplementation of
 * src/adapters/storage/atomic-write.ts's algorithm (why standalone: see that fixture's own
 * comment) — writes many chunks to a temp file with a short delay between each, so there's a wide
 * window in which to land a kill signal mid-write, then only renames if every chunk succeeds.
 *
 * Killed at several different offsets per docs/TESTES.md-style measurement discipline (same
 * spirit as S1-T0's "40 rounds, zero failures"): a single lucky kill timing proves less than
 * several different ones all landing on the same guarantee.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../../../src/adapters/storage/atomic-write.js';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/storage/slow-atomic-write.mjs', import.meta.url),
);

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'seeya-storage-atomic-'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawns the fixture (25 chunks of 4 KB, 20ms apart — long enough to reliably land a kill signal
 * mid-write on a loaded CI machine), waits for its 'writing' readiness line (proof real bytes are
 * already on disk before the kill), waits `extraDelayMs` more to land at a different point in the
 * multi-chunk write across calls, then force-kills it (`SIGKILL`/`TerminateProcess` — an abrupt
 * death, deliberately not the graceful shutdown S1-T2b's tests exercise) and waits for the OS to
 * confirm it's gone.
 */
async function killMidWrite(
  targetPath: string,
  extraDelayMs: number,
): Promise<{ tempFilesLeftBehind: string[] }> {
  const child = spawn(process.execPath, [FIXTURE, targetPath, 'x'.repeat(4096), '25', '20'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  let sawWriting = false;
  child.stdout.on('data', (chunk: Buffer) => {
    if (chunk.toString().includes('writing')) sawWriting = true;
  });

  const deadline = Date.now() + 5000;
  while (!sawWriting && Date.now() < deadline) {
    await sleep(5);
  }
  if (!sawWriting) {
    throw new Error(
      'fixture never printed "writing" within 5s — it may have failed before writing any chunk',
    );
  }

  await sleep(extraDelayMs);

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;

  const dir = path.dirname(targetPath);
  const entries = await readdir(dir);
  const tempFilesLeftBehind = entries.filter((name) => name.includes('.tmp-'));
  return { tempFilesLeftBehind };
}

describe('writeFileAtomic — atomicity proven by killing a real process mid-write', () => {
  it('a normal, uninterrupted write replaces the target in full (control case)', async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, 'config.json');
      await writeFileAtomic(target, 'old-content');
      await writeFileAtomic(target, 'new-content');
      expect(await readFile(target, 'utf8')).toBe('new-content');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('killing the writer mid-write never leaves the pre-existing target partially overwritten', async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, 'config.json');
      const oldContent = 'schemaVersion:1;old-and-complete';
      await writeFile(target, oldContent, 'utf8');

      for (const extraDelayMs of [0, 15, 40, 80, 150]) {
        const { tempFilesLeftBehind } = await killMidWrite(target, extraDelayMs);
        const onDisk = await readFile(target, 'utf8');
        expect(onDisk, `target corrupted after kill at +${extraDelayMs}ms`).toBe(oldContent);
        // A leftover temp file is expected garbage (see atomic-write.ts's comment), asserted here
        // only as evidence the kill genuinely landed mid-write, not before the fixture ever
        // touched disk — without this, "target intact" would be trivially true for the wrong
        // reason (nothing was ever attempted).
        expect(
          tempFilesLeftBehind.length,
          `no temp file found at +${extraDelayMs}ms — raw dir listing: ${JSON.stringify(await readdir(dir))}`,
        ).toBeGreaterThan(0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('killing the writer mid-write never creates a partial target when none existed before', async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, 'config.json');
      for (const extraDelayMs of [0, 30, 90]) {
        await killMidWrite(target, extraDelayMs);
        await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a failed write (e.g. rename target is a directory) cleans up its own temp file and rethrows, without leaving garbage', async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, 'config.json');
      // A directory can never be `rename`d over by a file (fails on both POSIX and Windows) —
      // the cheapest way to force writeFileAtomic's own failure path without needing a second
      // process.
      await mkdir(target);

      await expect(writeFileAtomic(target, 'new-content')).rejects.toBeTruthy();

      const entries = await readdir(dir);
      const leftoverTempFiles = entries.filter((name) => name.includes('.tmp-'));
      expect(leftoverTempFiles, `directory listing: ${JSON.stringify(entries)}`).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
