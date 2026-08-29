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
 * This function does not retry on that error. Retrying with a delay would need `setTimeout`,
 * banned everywhere outside `adapters/clock/` (D-019) — and there is no caller of this function
 * yet that reads and writes `config.json` concurrently (it's read-only in production until
 * S4-T4/`seeya config` and S5-T2/`seeya init` land) to justify adding a `Clock`-based backoff for
 * a race nobody can trigger today. The failure is loud (the promise rejects with `EPERM`) and
 * never corrupts anything — the old content is still fully intact on disk when this happens.
 * **Where this guard-rail ends:** whoever adds the first concurrent writer+reader of the same
 * document should re-measure before assuming this is still a non-issue.
 */
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
    await rename(tempPath, targetPath);
  } catch (error) {
    // Best-effort cleanup so a failed write doesn't litter the directory with `.tmp-*` files
    // forever. Never lets a cleanup failure hide the real error above — if the temp file is
    // already gone (e.g. the failure happened before `open`), `unlink` failing is not itself
    // news.
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
