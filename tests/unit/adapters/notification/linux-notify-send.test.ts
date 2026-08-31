/**
 * `LinuxNotifySendBackend` (docs/spikes/B-notificacoes.md § Linux). `run` is always a
 * `RecordingCommandRunner` here — a real `notify-send` is never spawned, so this suite is
 * exercisable on any of the three CI systems (including a headless Linux container with no
 * `libnotify` installed at all — exactly the case Spike B calls out, and exactly why the real
 * OS is never asked directly here).
 */
import { describe, expect, it } from 'vitest';
import {
  buildNotifySendArgs,
  LinuxNotifySendBackend,
} from '../../../../src/adapters/notification/linux-notify-send.js';
import { RecordingCommandRunner } from './_command-runner-fakes.js';

const NOTICE = { title: 'seeya end-day: 2026-08-16', body: '1 session captured.' };

describe('buildNotifySendArgs', () => {
  it('passes title and body as two separate argv elements, unescaped', () => {
    expect(buildNotifySendArgs(NOTICE)).toEqual([NOTICE.title, NOTICE.body]);
  });

  it('never emits an -A action flag — this task has no action buttons', () => {
    const args = buildNotifySendArgs({ title: 'has -A in it, literally', body: 'plain' });
    // The literal text is untouched (argv, not a shell string) — there's just no CODE path here
    // that adds a real `-A` flag anywhere in the array.
    expect(args).toHaveLength(2);
    expect(args).not.toContain('-A');
  });
});

describe('LinuxNotifySendBackend — isAvailable', () => {
  it('is unavailable outright on a non-Linux platform, without ever probing the command', async () => {
    const runner = new RecordingCommandRunner();
    const backend = new LinuxNotifySendBackend({ platform: 'win32', run: runner.run });

    await expect(backend.isAvailable()).resolves.toBe(false);
    expect(runner.calls).toHaveLength(0);
  });

  it('is available on linux when the probe exits 0', async () => {
    const runner = new RecordingCommandRunner({ exitCode: 0, stdout: '1.2.3', stderr: '' });
    const backend = new LinuxNotifySendBackend({ platform: 'linux', run: runner.run });

    await expect(backend.isAvailable()).resolves.toBe(true);
    expect(runner.calls[0]?.args).toEqual(['--version']);
  });

  it('is unavailable on linux when the probe exits non-zero (installed but broken)', async () => {
    const runner = new RecordingCommandRunner({ exitCode: 1, stdout: '', stderr: 'error' });
    const backend = new LinuxNotifySendBackend({ platform: 'linux', run: runner.run });

    await expect(backend.isAvailable()).resolves.toBe(false);
  });

  it('is unavailable on linux when the command does not exist at all (Spike B: headless server)', async () => {
    const throwingRun = () => Promise.reject(new Error('spawn notify-send ENOENT'));
    const backend = new LinuxNotifySendBackend({ platform: 'linux', run: throwingRun });

    await expect(backend.isAvailable()).resolves.toBe(false);
  });

  it('never claims to support actions', () => {
    expect(new LinuxNotifySendBackend().supportsActions()).toBe(false);
  });
});

describe('LinuxNotifySendBackend — send', () => {
  it('spawns the configured command with the exact notify-send arguments', async () => {
    const runner = new RecordingCommandRunner();
    const backend = new LinuxNotifySendBackend({ command: 'fake-notify-send', run: runner.run });

    await backend.send(NOTICE);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command).toBe('fake-notify-send');
    expect(runner.calls[0]?.args).toEqual(buildNotifySendArgs(NOTICE));
  });

  it('throws when notify-send exits non-zero, with the raw stderr in the message', async () => {
    const runner = new RecordingCommandRunner({ exitCode: 1, stdout: '', stderr: 'no such bus' });
    const backend = new LinuxNotifySendBackend({ run: runner.run });

    await expect(backend.send(NOTICE)).rejects.toThrow(/exited 1.*no such bus/s);
  });
});
