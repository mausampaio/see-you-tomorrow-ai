/**
 * `readCwdFromTranscript` against a real filesystem (not a temp-file-via-shell round-trip — the
 * mantainer's own note in the task: reading a shell-written temp file produced a false "truncated"
 * conclusion once; these fixtures are written with `node:fs/promises` `writeFile`, `utf8`
 * explicit, same as the module under test).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readCwdFromTranscript } from '../../../src/adapters/discovery/transcript-cwd.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  transcriptLine,
  writeTranscriptWithContent,
  type DiscoveryFixture,
} from './_fixtures.js';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

describe('readCwdFromTranscript — happy path', () => {
  it('finds cwd on the first line', async () => {
    fixture = await createDiscoveryFixture();
    const file = await writeTranscriptWithContent(
      fixture,
      'slug',
      '11111111-1111-4111-8111-111111111111',
      transcriptLine('c:\\code\\projeto-01'),
    );

    const result = await readCwdFromTranscript(file);

    expect(result.cwd).toBe('c:\\code\\projeto-01');
  });

  it('skips lines without a cwd field (other entry types) before finding one that has it', async () => {
    fixture = await createDiscoveryFixture();
    const content =
      `${JSON.stringify({ type: 'queue-operation' })}\n` +
      `${JSON.stringify({ type: 'mode', value: 'plan' })}\n` +
      transcriptLine('c:\\code\\projeto-02');
    const file = await writeTranscriptWithContent(
      fixture,
      'slug',
      '22222222-2222-4222-8222-222222222222',
      content,
    );

    const result = await readCwdFromTranscript(file);

    expect(result.cwd).toBe('c:\\code\\projeto-02');
  });

  it('skips a malformed line and keeps scanning to find cwd on a later line', async () => {
    fixture = await createDiscoveryFixture();
    const content = `not json at all {{{\n${transcriptLine('c:\\code\\projeto-03')}`;
    const file = await writeTranscriptWithContent(
      fixture,
      'slug',
      '33333333-3333-4333-8333-333333333333',
      content,
    );

    const result = await readCwdFromTranscript(file);

    expect(result.cwd).toBe('c:\\code\\projeto-03');
  });
});

describe('readCwdFromTranscript — truncated / incomplete content (docs/TESTES.md)', () => {
  /**
   * Claude Code can be writing the transcript at the exact moment `seeya` reads it — the final
   * line may be a partial write with no closing `\n` and no closing `}`. This must never throw,
   * and if it's the *only* content, the honest answer is "no cwd found", not a crash and not an
   * invented value (D-025).
   */
  it('a file whose only content is a truncated final line (no trailing newline) yields cwd: null, not a throw', async () => {
    fixture = await createDiscoveryFixture();
    const truncated = '{"type":"user","cwd":"c:\\\\code\\\\proj';
    const file = await writeTranscriptWithContent(
      fixture,
      'slug',
      '44444444-4444-4444-8444-444444444444',
      truncated,
    );

    const result = await readCwdFromTranscript(file);

    expect(result.cwd).toBeNull();
  });

  it('a truncated line followed by nothing else does not stop a *different* file from being read normally', async () => {
    fixture = await createDiscoveryFixture();
    const truncatedFile = await writeTranscriptWithContent(
      fixture,
      'slug',
      '55555555-5555-4555-8555-555555555555',
      '{"type":"assistant","cwd":"c:\\\\trunc',
    );
    const healthyFile = await writeTranscriptWithContent(
      fixture,
      'slug',
      '66666666-6666-4666-8666-666666666666',
      transcriptLine('c:\\code\\projeto-06'),
    );

    const [truncatedResult, healthyResult] = await Promise.all([
      readCwdFromTranscript(truncatedFile),
      readCwdFromTranscript(healthyFile),
    ]);

    expect(truncatedResult.cwd).toBeNull();
    expect(healthyResult.cwd).toBe('c:\\code\\projeto-06');
  });

  it('an empty file yields cwd: null, not a throw', async () => {
    fixture = await createDiscoveryFixture();
    const file = await writeTranscriptWithContent(
      fixture,
      'slug',
      '77777777-7777-4777-8777-777777777777',
      '',
    );

    const result = await readCwdFromTranscript(file);

    expect(result.cwd).toBeNull();
  });

  it('a well-formed line with no cwd field at all yields cwd: null when it is the only content', async () => {
    fixture = await createDiscoveryFixture();
    const file = await writeTranscriptWithContent(
      fixture,
      'slug',
      '88888888-8888-4888-8888-888888888888',
      `${JSON.stringify({ type: 'queue-operation' })}\n`,
    );

    const result = await readCwdFromTranscript(file);

    expect(result.cwd).toBeNull();
  });
});

describe('readCwdFromTranscript — stops early on a large file (docs/TESTES.md > 1 MB fixture)', () => {
  /**
   * Proof, not assertion: `bytesRead` is the module's own count of what it consumed off the
   * stream before resolving. A >1 MB file with `cwd` on line one has to come back with `bytesRead`
   * far below the file size, or the "never read the whole file" claim in the module's docstring
   * would be untrue — this is what would catch that regression.
   */
  it('reads far less than the file size when cwd is on the first line of a >1 MB file', async () => {
    fixture = await createDiscoveryFixture();
    const padding = `${JSON.stringify({ type: 'assistant', payload: 'x'.repeat(1000) })}\n`.repeat(
      1500, // ~1500 * ~1030 bytes ≈ 1.5 MB of padding after the first line
    );
    const content = transcriptLine('c:\\code\\projeto-grande') + padding;
    const file = await writeTranscriptWithContent(
      fixture,
      'slug',
      '99999999-9999-4999-8999-999999999999',
      content,
    );
    expect(content.length).toBeGreaterThan(1_000_000);

    const result = await readCwdFromTranscript(file);

    expect(result.cwd).toBe('c:\\code\\projeto-grande');
    expect(result.bytesRead).toBeLessThan(content.length / 10);
  });
});

describe('readCwdFromTranscript — real I/O failures reject, not swallowed', () => {
  it('rejects when the path does not exist', async () => {
    fixture = await createDiscoveryFixture();
    const missing = path.join(fixture.projectsDir, 'slug', 'nope.jsonl');

    await expect(readCwdFromTranscript(missing)).rejects.toBeDefined();
  });

  it('rejects when the path is a directory, not a file', async () => {
    fixture = await createDiscoveryFixture();
    const dirPath = path.join(fixture.projectsDir, 'slug', 'a-directory.jsonl');
    await mkdir(dirPath, { recursive: true });

    await expect(readCwdFromTranscript(dirPath)).rejects.toBeDefined();
  });
});
