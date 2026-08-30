import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeSessionResumer } from '../../../src/adapters/resumption/resumer.js';
import { RESUME_PROMPT_ARG_LIMIT_CHARS } from '../../../src/adapters/resumption/args.js';
import {
  createFakeInteractiveClaudeFixture,
  readCapturedInteractiveClaudeCalls,
  removeFakeInteractiveClaudeFixture,
  type FakeInteractiveClaudeFixture,
} from './_fixtures.js';

/** Env vars this file may set on the TEST process before spawning — every one restored to its
 * prior value in `afterEach`, same discipline `tests/integration/generation/lean-generator.test.ts`
 * uses (AGENTS.md § Testes: "independente" taken seriously, even though vitest's default pool
 * already isolates files from each other). */
/** A real, existing directory: `spawn`'s own `cwd` check fails fast (`ENOENT`) against a `cwd`
 * that doesn't exist, which would otherwise make every "fast failure" test indistinguishable from
 * "the fixture's binary path was wrong". */
const PROJECT_CWD = process.cwd();

const ENV_VARS_UNDER_TEST = [
  'FAKE_CLAUDE_CAPTURE_FILE',
  'FAKE_CLAUDE_EXIT_CODE',
  'FAKE_CLAUDE_EXIT_DELAY_MS',
  'FAKE_CLAUDE_FAIL_IF_RESUME',
  'CLAUDE_CODE_CHILD_SESSION',
] as const;

/**
 * End-to-end test of `ClaudeSessionResumer` against a real spawned process (S3-T2, D-004). Proves
 * the branching this task exists for: a small prompt resumes; a fast, non-zero `--resume` exit
 * falls back to a fresh session carrying the SAME prompt via a file, never the argument; an
 * oversized prompt skips the argument attempt entirely; and a fallback that also fails fast is a
 * hard error, never a silently-wrong "it worked" outcome (D-025 applied to an action).
 */
describe('ClaudeSessionResumer — S3-T2', () => {
  let fixture: FakeInteractiveClaudeFixture;
  let seeyaHome: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    fixture = await createFakeInteractiveClaudeFixture();
    seeyaHome = await mkdtemp(path.join(tmpdir(), 'seeya-resumer-'));
    savedEnv = Object.fromEntries(ENV_VARS_UNDER_TEST.map((name) => [name, process.env[name]]));
    process.env['FAKE_CLAUDE_CAPTURE_FILE'] = fixture.captureFile;
  });

  afterEach(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await removeFakeInteractiveClaudeFixture(fixture);
    await rm(seeyaHome, { recursive: true, force: true });
  });

  it('attaches cleanly when --resume succeeds: fellBack is false, one call, the argument prompt', async () => {
    process.env['FAKE_CLAUDE_EXIT_CODE'] = '0';
    const resumer = new ClaudeSessionResumer({ seeyaHome, claudeBinary: fixture.binaryPath });

    const outcome = await resumer.resume('session-1', PROJECT_CWD, "yesterday's plan");

    expect(outcome).toStrictEqual({ sessionId: 'session-1', cwd: PROJECT_CWD, fellBack: false });
    const calls = await readCapturedInteractiveClaudeCalls(fixture);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.argv).toStrictEqual(['--resume', 'session-1', "yesterday's plan"]);
  });

  it(
    'falls back on a fast, non-zero --resume exit: reports resumeFailed, the fallback carries ' +
      'the same prompt through a file, and the scratch file is cleaned up after',
    async () => {
      process.env['FAKE_CLAUDE_FAIL_IF_RESUME'] = '1';
      const resumer = new ClaudeSessionResumer({
        seeyaHome,
        claudeBinary: fixture.binaryPath,
        fastFailureGraceMs: 2_000,
      });

      const outcome = await resumer.resume('session-1', PROJECT_CWD, "yesterday's plan");

      expect(outcome.fellBack).toStrictEqual({ kind: 'resumeFailed', exitCode: 1 });
      const calls = await readCapturedInteractiveClaudeCalls(fixture);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.argv).toStrictEqual(['--resume', 'session-1', "yesterday's plan"]);
      expect(calls[1]?.argv[0]).toBe('--append-system-prompt-file');
      expect(calls[1]?.argv).not.toContain('--resume');

      // The fake binary already read the context file before this adapter's cleanup runs
      // (`resumer.ts`'s `finally`), so an empty `tmp/` afterward proves cleanup happened rather
      // than the file never having existed.
      const tmpDirEntries = await readdir(path.join(seeyaHome, 'tmp'));
      expect(tmpDirEntries).toHaveLength(0);
      expect(calls[1]?.argv[1]).toContain(path.join(seeyaHome, 'tmp'));
    },
  );

  it('skips the --resume attempt entirely when the prompt exceeds the size threshold', async () => {
    process.env['FAKE_CLAUDE_EXIT_CODE'] = '0';
    const oversized = 'x'.repeat(RESUME_PROMPT_ARG_LIMIT_CHARS + 1);
    const resumer = new ClaudeSessionResumer({ seeyaHome, claudeBinary: fixture.binaryPath });

    const outcome = await resumer.resume('session-1', PROJECT_CWD, oversized);

    expect(outcome.fellBack).toStrictEqual({
      kind: 'promptTooLarge',
      promptLength: oversized.length,
      limitChars: RESUME_PROMPT_ARG_LIMIT_CHARS,
    });
    const calls = await readCapturedInteractiveClaudeCalls(fixture);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.argv).not.toContain('--resume');
    // Read by the fake process itself, before this adapter's own cleanup deleted the scratch
    // file — reading the path back here, after `resume()` already returned, would always find it
    // gone (that cleanup is the point).
    expect(calls[0]?.contextFileContent).toBe(oversized);
  });

  it('throws when the fallback ALSO fails fast — never reports a fresh session that never opened', async () => {
    process.env['FAKE_CLAUDE_EXIT_CODE'] = '1';
    process.env['FAKE_CLAUDE_EXIT_DELAY_MS'] = '10';
    const resumer = new ClaudeSessionResumer({
      seeyaHome,
      claudeBinary: fixture.binaryPath,
      fastFailureGraceMs: 2_000,
    });

    await expect(resumer.resume('session-1', PROJECT_CWD, 'a short plan')).rejects.toThrow(
      /also failed to start/,
    );
  });

  it('throws with the promptTooLarge reason in the message when THAT fallback also fails fast', async () => {
    process.env['FAKE_CLAUDE_EXIT_CODE'] = '1';
    process.env['FAKE_CLAUDE_EXIT_DELAY_MS'] = '10';
    const oversized = 'x'.repeat(RESUME_PROMPT_ARG_LIMIT_CHARS + 1);
    const resumer = new ClaudeSessionResumer({
      seeyaHome,
      claudeBinary: fixture.binaryPath,
      fastFailureGraceMs: 2_000,
    });

    await expect(resumer.resume('session-1', PROJECT_CWD, oversized)).rejects.toThrow(
      /over the 4096-character limit/,
    );
  });

  it('sanitizes the child env (D-017), even when nothing else about the call needs it', async () => {
    process.env['FAKE_CLAUDE_EXIT_CODE'] = '0';
    process.env['CLAUDE_CODE_CHILD_SESSION'] = '1';
    const resumer = new ClaudeSessionResumer({ seeyaHome, claudeBinary: fixture.binaryPath });

    await resumer.resume('session-1', PROJECT_CWD, 'a short plan');

    const [call] = await readCapturedInteractiveClaudeCalls(fixture);
    expect(call?.env['CLAUDE_CODE_CHILD_SESSION']).toBeUndefined();
  });
});
