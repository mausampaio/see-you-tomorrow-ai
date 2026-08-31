/**
 * `spawnCommand` (`adapters/notification/backend.ts`) against a REAL process — the one piece of
 * this adapter every backend's own test replaces with `RecordingCommandRunner`
 * (`tests/unit/adapters/notification/_command-runner-fakes.ts`), on purpose, to keep `npm test`
 * from ever popping a real OS notification. This file proves the generic spawn plumbing itself
 * (argument array, `shell: false`, stdout/stderr capture, exit code) still works, using the
 * current Node binary — always present, harmless, and produces no visible side effect at all —
 * rather than any real notification command.
 */
import { describe, expect, it } from 'vitest';
import { spawnCommand } from '../../../src/adapters/notification/backend.js';

describe('spawnCommand', () => {
  it('resolves with stdout and exit code 0 for a real, successful process', async () => {
    const result = await spawnCommand(process.execPath, ['--version']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('resolves with a non-zero exit code and stderr for a real process that fails', async () => {
    const result = await spawnCommand(process.execPath, ['--this-flag-does-not-exist']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('rejects when the command itself does not exist', async () => {
    await expect(
      spawnCommand('seeya-notification-command-that-does-not-exist', []),
    ).rejects.toThrow();
  });
});
