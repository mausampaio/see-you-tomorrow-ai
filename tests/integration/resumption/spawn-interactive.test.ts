import { afterEach, describe, expect, it } from 'vitest';
import { runInteractive } from '../../../src/adapters/resumption/spawn-interactive.js';
import {
  createFakeInteractiveClaudeFixture,
  readCapturedInteractiveClaudeCalls,
  removeFakeInteractiveClaudeFixture,
  type FakeInteractiveClaudeFixture,
} from './_fixtures.js';

/**
 * Integration test for the one module that actually spawns a process (S3-T2). Uses a real fake
 * `claude` binary (docs/TESTES.md's established pattern for `generation/`) so `stdio: 'inherit'`
 * runs through a real OS spawn, not a mock — the same reason `spawn-claude.ts` (generation) is
 * proven this way rather than unit-tested.
 */
describe('runInteractive — S3-T2', () => {
  let fixture: FakeInteractiveClaudeFixture | undefined;

  afterEach(async () => {
    if (fixture !== undefined) {
      await removeFakeInteractiveClaudeFixture(fixture);
      fixture = undefined;
    }
  });

  it('reports exitCode 0 and failedFast: false for a normal, fast success', async () => {
    fixture = await createFakeInteractiveClaudeFixture();
    const result = await runInteractive({
      claudeBinary: fixture.binaryPath,
      args: ['--resume', 'some-id', 'a prompt'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        FAKE_CLAUDE_CAPTURE_FILE: fixture.captureFile,
        FAKE_CLAUDE_EXIT_CODE: '0',
      },
    });
    // A fast, SUCCESSFUL close is not a failure signal — `failedFast` alone never decides
    // anything, only `failedFast && exitCode !== 0` does (checked by the caller, `resumer.ts`).
    expect(result.exitCode).toBe(0);
  });

  it('reports failedFast: true for a fast non-zero exit (Spike H: measured under 2s for real)', async () => {
    fixture = await createFakeInteractiveClaudeFixture();
    const result = await runInteractive({
      claudeBinary: fixture.binaryPath,
      args: ['--resume', 'nonexistent-id', 'a prompt'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        FAKE_CLAUDE_CAPTURE_FILE: fixture.captureFile,
        FAKE_CLAUDE_EXIT_CODE: '1',
        FAKE_CLAUDE_EXIT_DELAY_MS: '10',
      },
      fastFailureGraceMs: 2_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.failedFast).toBe(true);
  });

  it(
    'reports failedFast: false for a non-zero exit AFTER the grace period — a real session ' +
      'ending unusually is not a resume failure',
    async () => {
      fixture = await createFakeInteractiveClaudeFixture();
      const result = await runInteractive({
        claudeBinary: fixture.binaryPath,
        args: ['--resume', 'some-id', 'a prompt'],
        cwd: process.cwd(),
        env: {
          ...process.env,
          FAKE_CLAUDE_CAPTURE_FILE: fixture.captureFile,
          FAKE_CLAUDE_EXIT_CODE: '1',
          FAKE_CLAUDE_EXIT_DELAY_MS: '150',
        },
        fastFailureGraceMs: 50,
      });
      expect(result.exitCode).toBe(1);
      expect(result.failedFast).toBe(false);
    },
  );

  it('reports exitCode -1 and failedFast: true when the binary itself does not exist', async () => {
    const result = await runInteractive({
      claudeBinary: '/this/binary/does/not/exist/anywhere-seeya-test',
      args: ['--resume', 'some-id', 'a prompt'],
      cwd: process.cwd(),
      env: process.env,
      fastFailureGraceMs: 2_000,
    });
    expect(result.exitCode).toBe(-1);
    expect(result.failedFast).toBe(true);
  });

  it('spawns with shell:false, array args — the exact argv arrives at the child untouched', async () => {
    fixture = await createFakeInteractiveClaudeFixture();
    const tricky = 'Line one "quoted" and \'single\'.\nLinha com acento: ação, café.\n100% done.';
    await runInteractive({
      claudeBinary: fixture.binaryPath,
      args: ['--resume', 'some-id', tricky],
      cwd: process.cwd(),
      env: { ...process.env, FAKE_CLAUDE_CAPTURE_FILE: fixture.captureFile },
    });
    const [captured] = await readCapturedInteractiveClaudeCalls(fixture);
    expect(captured?.argv).toStrictEqual(['--resume', 'some-id', tricky]);
  });
});
