/**
 * Atomic write for anything under `~/.seeya/` (docs/ARQUITETURA.md § "Sistema de arquivos": "Toda
 * escrita é atômica: temporário + rename"). Writes the full content to a temp file in the SAME
 * directory as `targetPath` — same filesystem/volume, because a `rename` across volumes isn't
 * atomic, it degrades to copy+delete under the hood on every OS — `fsync`s it, then renames it
 * over the real path. `rename` is a single filesystem operation on both POSIX and Windows, so a
 * reader can only ever observe the fully-old file or the fully-new one, never a partial write: a
 * process dying (even `SIGKILL`/`TerminateProcess`) either never reaches the rename at all (target
 * untouched) or has already handed the completed rename off to the kernel before dying (target
 * fully replaced) — there's no OS-observable state in between.
 *
 * Proven by execution, not just argued: tests/integration/storage/atomic-write.test.ts kills a
 * real child process mid-write, at several different points, and inspects what's actually left on
 * disk.
 *
 * **A real Windows/POSIX difference, measured here, not assumed.** `fs.rename` over an existing,
 * unopened destination behaves the same on both platforms (Node/libuv already issues
 * `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` on Windows — verified directly on this machine
 * before writing this function). But if another process holds the DESTINATION file open for
 * reading at the exact instant of rename, Windows refuses the rename outright (`EPERM`), measured
 * directly on this machine, where POSIX would silently succeed (a reader keeps its already-open
 * handle to the old inode; the directory entry just moves to point at the new one).
 *
 * **S4-T4b (Q-058) re-measured this once a real concurrent writer existed** (`seeya
 * snooze`/`config` racing the daemon's poll, S4-T4): 300 concurrent read/write iterations, 3 runs
 * per file, on this machine — `estado.json` 60/300, 64/300, 56/300 (~18-21%) writes rejected with
 * `EPERM`; `config.json` 63/300, 63/300, 55/300 (~18-21%). Reads: 0/300 corrupted, every run, both
 * files — the rename-based swap held. That confirms the risk this comment used to only predict:
 * the writer's promise really does reject on close to 1 in 5 calls under sustained contention, and
 * nothing downstream caught it (it propagated raw to `cli/index.ts`'s top-level `.catch`).
 *
 * **The fix below is a bounded retry of the `rename` step only**, on `EPERM` only — the one error
 * code ever observed in either measurement, on either file. Not `setTimeout`/a `Clock`: the delay
 * between attempts is a bare `setImmediate` (deferring to the next turn of the event loop, not
 * reading or scheduling against real time), because the race is an event-loop ordering problem —
 * the concurrent reader's `open`+`read`+`close` needs a turn to finish before the destination is
 * free again — not a real-world timing problem that needs a `Clock`-controlled backoff. Threading
 * a `Clock` through here would mean giving every one of `StorageAdapter`'s 8 methods (and every
 * one of the ~100 test call sites that construct it with just a `seeyaHome` string today) a second
 * constructor argument, for a module whose whole job is "no dependencies, just `fs`" — see
 * docs/QUESTOES.md Q-058 for why that trade wasn't taken here and what would change the answer.
 *
 * **`MAX_RENAME_ATTEMPTS = 8` (7 retries), tuned by re-running the same measurement, not
 * guessed.** A naive independence assumption (`0.2^N`) predicts a residual near zero by 5
 * attempts, but this test's tight loop correlates consecutive failures (the same reader is often
 * still mid-`open`/`read` one event-loop turn later), so the real curve is shallower than that:
 * measured on this machine, 300 iterations/3 runs per file, per attempt cap —
 *
 * | `MAX_RENAME_ATTEMPTS` | `estado.json` writes rejected | `config.json` writes rejected |
 * |---|---|---|
 * | 1 (no retry, original) | 60, 64, 56 / 300 (~18–21%) | 63, 63, 55 / 300 (~18–21%) |
 * | 5 | 6, 8, 5 / 300 (~2–3%) | 7, 14, 9 / 300 (~2–5%) |
 * | 8 (chosen) | 3, 5, 1 / 300 (~0.3–1.7%) | 2, 1, 1 / 300 (~0.3–0.7%) |
 *
 * 8 was picked as the point past which more attempts bought little (10 attempts measured
 * 0–0.7%, not meaningfully better than 8) while staying bounded (cuidado (a), S4-T4b): a real
 * permission problem (antivirus holding the file long-term, a read-only volume) is NOT
 * `EPERM`-on-a-transient-reader — or if it happens to be, it re-fails all 8 attempts identically
 * and still surfaces, in well under a millisecond of `setImmediate` turns, never a wait-forever.
 * Every other rename error (a real permission failure that isn't `EPERM`, a missing directory,
 * disk full) is never retried — it was never part of either measurement, and retrying an error
 * class nobody has observed here would be guessing, not fixing.
 *
 * **When attempts are exhausted, this throws a message that names the file and says what
 * happened** (AGENTS.md § "Mensagens de erro") — not the raw Node `EPERM` text — with the original
 * error attached as `.cause` for anyone who does want the low-level detail.
 */
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { nodeErrorCode } from './fs-errors.js';

/** See the module comment's measurement table: 8 total attempts (1 try + 7 retries) drove the
 * measured ~20%-per-attempt `EPERM` rate down to ~0.3–1.7%, and going further (10 attempts) didn't
 * meaningfully improve on that — this is the point of diminishing returns, not a round number. */
const MAX_RENAME_ATTEMPTS = 8;

/** Defers to the next turn of the event loop — not a timer, not a clock read (D-019 bans reading
 * "now" and scheduling against real time outside `adapters/clock/`; this schedules against event
 * loop turns instead, which is what actually resolves the race: the concurrent reader's
 * `open`+`read`+`close` needs a turn to finish, not a fixed number of milliseconds). */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Renames `tempPath` to `targetPath`, retrying up to `MAX_RENAME_ATTEMPTS` times when the failure
 * is `EPERM` (the only error this module's own measurement — see the module comment — has ever
 * seen from `rename`, always caused by a reader holding `targetPath` open at the exact instant of
 * the swap). Any other error, or an `EPERM` that outlives every attempt, is rethrown as-is to the
 * caller in `writeFileAtomic`, which turns it into a readable message.
 */
async function renameWithRetry(tempPath: string, targetPath: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await rename(tempPath, targetPath);
      return;
    } catch (error) {
      const isLastAttempt = attempt === MAX_RENAME_ATTEMPTS;
      if (nodeErrorCode(error) !== 'EPERM' || isLastAttempt) {
        throw error;
      }
      await yieldToEventLoop();
    }
  }
}

/**
 * Writes `content` to `targetPath` atomically. Creates `targetPath`'s parent directory if it
 * doesn't exist yet (first write into a fresh `~/.seeya/`) — same "absence is normal, not an
 * error" spirit as the read side (D-025).
 */
export async function writeFileAtomic(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  // Leading dot: an interrupted write leaves this behind (see the module comment above), and a
  // dotfile is the least surprising way to mark it as "not a real document" to anyone who lists
  // the directory by hand.
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${randomUUID()}`);

  try {
    const handle = await open(tempPath, 'w');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tempPath, targetPath);
  } catch (error) {
    // Best-effort cleanup so a failed write doesn't litter the directory with `.tmp-*` files
    // forever. Never lets a cleanup failure hide the real error above — if the temp file is
    // already gone (e.g. the failure happened before `open`), `unlink` failing is not itself
    // news.
    await unlink(tempPath).catch(() => undefined);
    if (nodeErrorCode(error) === 'EPERM') {
      // AGENTS.md § "Mensagens de erro": name the file and say what happened, never the raw Node
      // text ("EPERM: operation not permitted, rename '...' -> '...'") and never a bare stack
      // trace — this is what a `seeya snooze`/`config`/daemon-poll caller ends up surfacing to
      // whoever ran the command (S4-T4b/Q-058). The on-disk file is untouched at its previous
      // value; only this one write didn't land.
      throw new Error(
        `could not save ${targetPath}: still locked by another process after ` +
          `${MAX_RENAME_ATTEMPTS} attempts. The previous version on disk is untouched — try again.`,
        { cause: error },
      );
    }
    throw error;
  }
}
