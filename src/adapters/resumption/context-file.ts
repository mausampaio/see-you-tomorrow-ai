/**
 * Writes and removes the scratch file `--append-system-prompt-file` reads for a fallback session
 * (D-004, D-015). This is the one place `adapters/resumption` touches disk beyond spawning a
 * process.
 *
 * **Lives under the injected `seeyaHome` root, in a `tmp/` subdirectory (AGENTS.md § "Sistema de
 * arquivos": "escrever apenas dentro de `~/.seeya/`").** Not a plain `os.tmpdir()` scratch file —
 * that would be a real, if narrow, violation of the one filesystem rule this whole project treats
 * as non-negotiable, for the sake of a file nothing else ever reads back.
 *
 * **Plain write, not atomic.** `writeFileAtomic` (`adapters/storage/atomic-write.ts`) exists to
 * protect a document a concurrent reader might observe half-written — the durable case. This file
 * is read exactly once, by the `claude` process this module spawns immediately after the write
 * promise already resolved; nothing else ever opens it, so there is no concurrent reader to
 * protect against, and the atomic dance would add cost for a guarantee nothing here needs.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TMP_SUBDIR = 'tmp';

/** Writes `content` and returns the absolute path. `sessionId` is folded into the file name only
 * to make a stray leftover (a crash between write and cleanup) traceable to which session it was
 * for; uniqueness itself comes from the appended UUID, so two fallbacks for the same session in
 * the same run never collide. */
export async function writeFallbackContextFile(
  seeyaHome: string,
  sessionId: string,
  content: string,
): Promise<string> {
  const dir = path.join(seeyaHome, TMP_SUBDIR);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `resume-fallback-${sessionId}-${randomUUID()}.txt`);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * Best-effort cleanup after the fallback `claude` process has exited. Swallows `ENOENT` only
 * (D-025's spirit applied to cleanup: a file already gone — someone deleted it by hand, or a
 * previous attempt at cleanup already ran — satisfies the goal just as well as this call
 * succeeding would have) and rethrows anything else, so a real permission problem doesn't vanish
 * silently.
 */
export async function removeFallbackContextFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    throw error;
  }
}
