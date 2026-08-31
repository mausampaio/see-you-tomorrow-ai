/**
 * `MacOsascriptBackend` (docs/spikes/B-notificacoes.md § macOS). `run` is always a
 * `RecordingCommandRunner` here — a real `osascript` is never spawned, so this suite is
 * exercisable on any of the three CI systems and never shows a real banner on whoever runs
 * `npm test`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildOsascriptArgs,
  MacOsascriptBackend,
} from '../../../../src/adapters/notification/macos-osascript.js';
import { RecordingCommandRunner } from './_command-runner-fakes.js';

const NOTICE = { title: 'seeya end-day: 2026-08-16', body: '1 session captured.' };

describe('buildOsascriptArgs', () => {
  it('builds a single -e AppleScript argument with title and body', () => {
    const args = buildOsascriptArgs(NOTICE);
    expect(args[0]).toBe('-e');
    expect(args[1]).toContain(
      'display notification "1 session captured." with title "seeya end-day: 2026-08-16"',
    );
  });

  it('never emits a button/action clause — this task has no action buttons', () => {
    expect(buildOsascriptArgs(NOTICE)[1]).not.toContain('buttons');
  });

  it('escapes a double quote and a backslash in the body', () => {
    const args = buildOsascriptArgs({ title: 'title', body: 'say "hi" \\ done' });
    expect(args[1]).toContain('say \\"hi\\" \\\\ done');
  });

  it('flattens an embedded newline to a space — AppleScript string literals cannot hold one', () => {
    const args = buildOsascriptArgs({ title: 'title', body: 'line one\nline two' });
    expect(args[1]).toContain('line one line two');
    expect(args[1]).not.toContain('\n');
  });
});

describe('MacOsascriptBackend — isAvailable', () => {
  it('is available on darwin', async () => {
    await expect(new MacOsascriptBackend({ platform: 'darwin' }).isAvailable()).resolves.toBe(true);
  });

  it('is not available on win32 or linux', async () => {
    await expect(new MacOsascriptBackend({ platform: 'win32' }).isAvailable()).resolves.toBe(false);
    await expect(new MacOsascriptBackend({ platform: 'linux' }).isAvailable()).resolves.toBe(false);
  });

  it('never claims to support actions', () => {
    expect(new MacOsascriptBackend().supportsActions()).toBe(false);
  });
});

describe('MacOsascriptBackend — send', () => {
  it('spawns the configured command with the exact osascript arguments', async () => {
    const runner = new RecordingCommandRunner();
    const backend = new MacOsascriptBackend({ command: 'fake-osascript', run: runner.run });

    await backend.send(NOTICE);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command).toBe('fake-osascript');
    expect(runner.calls[0]?.args).toEqual(buildOsascriptArgs(NOTICE));
  });

  it('throws when osascript exits non-zero, with the raw stderr in the message', async () => {
    const runner = new RecordingCommandRunner({ exitCode: 1, stdout: '', stderr: 'not permitted' });
    const backend = new MacOsascriptBackend({ run: runner.run });

    await expect(backend.send(NOTICE)).rejects.toThrow(/exited 1.*not permitted/s);
  });
});
