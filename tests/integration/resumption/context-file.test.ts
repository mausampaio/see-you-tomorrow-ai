import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  removeFallbackContextFile,
  writeFallbackContextFile,
} from '../../../src/adapters/resumption/context-file.js';

/**
 * Real filesystem, real tmpdir root standing in for `~/.seeya` — same discipline
 * `tests/integration/storage/atomic-write.test.ts` uses for S1-T5. AGENTS.md § "Sistema de
 * arquivos": writes only ever land under the injected root, in `tmp/`.
 */
describe('writeFallbackContextFile / removeFallbackContextFile — S3-T2', () => {
  let seeyaHome: string;

  beforeEach(async () => {
    seeyaHome = await mkdtemp(path.join(tmpdir(), 'seeya-context-file-'));
  });

  afterEach(async () => {
    await rm(seeyaHome, { recursive: true, force: true });
  });

  it('writes the content under <seeyaHome>/tmp/, not the raw tmpdir root', async () => {
    const filePath = await writeFallbackContextFile(seeyaHome, 'session-1', 'yesterday plan text');
    expect(path.dirname(filePath)).toBe(path.join(seeyaHome, 'tmp'));
    expect(await readFile(filePath, 'utf8')).toBe('yesterday plan text');
  });

  it('names the file traceably to the session, but stays unique across calls', async () => {
    const first = await writeFallbackContextFile(seeyaHome, 'session-1', 'plan A');
    const second = await writeFallbackContextFile(seeyaHome, 'session-1', 'plan B');
    expect(first).not.toBe(second);
    expect(path.basename(first)).toContain('session-1');
    expect(await readFile(first, 'utf8')).toBe('plan A');
    expect(await readFile(second, 'utf8')).toBe('plan B');
  });

  it('preserves quotes, newlines, accents and % — same D-015 integrity guarantee as stdin', async () => {
    const tricky = 'Line "one"\nLinha com acento: ação\n100% done, `x`';
    const filePath = await writeFallbackContextFile(seeyaHome, 'session-1', tricky);
    expect(await readFile(filePath, 'utf8')).toBe(tricky);
  });

  it('removeFallbackContextFile deletes the file', async () => {
    const filePath = await writeFallbackContextFile(seeyaHome, 'session-1', 'text');
    await removeFallbackContextFile(filePath);
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removeFallbackContextFile on an already-absent file does not throw (D-025)', async () => {
    const filePath = path.join(seeyaHome, 'tmp', 'never-written.txt');
    await expect(removeFallbackContextFile(filePath)).resolves.toBeUndefined();
  });

  it('removeFallbackContextFile rethrows a real error other than ENOENT', async () => {
    // `unlink` on a directory fails with EISDIR/EPERM depending on platform — never ENOENT —
    // which is exactly the "real problem, don't swallow it" case this function must not hide.
    const dirPath = path.join(seeyaHome, 'tmp', 'a-directory-not-a-file');
    await mkdir(dirPath, { recursive: true });
    await expect(removeFallbackContextFile(dirPath)).rejects.not.toMatchObject({ code: 'ENOENT' });
  });
});
