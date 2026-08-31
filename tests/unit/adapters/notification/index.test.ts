import { describe, expect, it } from 'vitest';
import { buildDefaultBackends, notifier } from '../../../../src/adapters/notification/index.js';
import { WindowsToastBackend } from '../../../../src/adapters/notification/windows-toast.js';
import { MacOsascriptBackend } from '../../../../src/adapters/notification/macos-osascript.js';
import { LinuxNotifySendBackend } from '../../../../src/adapters/notification/linux-notify-send.js';

describe('buildDefaultBackends', () => {
  it('picks WindowsToastBackend on win32', () => {
    const [backend] = buildDefaultBackends('win32');
    expect(backend).toBeInstanceOf(WindowsToastBackend);
  });

  it('picks MacOsascriptBackend on darwin', () => {
    const [backend] = buildDefaultBackends('darwin');
    expect(backend).toBeInstanceOf(MacOsascriptBackend);
  });

  it('picks LinuxNotifySendBackend on linux', () => {
    const [backend] = buildDefaultBackends('linux');
    expect(backend).toBeInstanceOf(LinuxNotifySendBackend);
  });

  it('returns no native backend for an unrecognized platform — ChainNotifier still works via stderr', () => {
    expect(buildDefaultBackends('aix')).toEqual([]);
  });
});

describe('notifier', () => {
  it('is a ready-to-use singleton implementing the Notifier port', () => {
    expect(typeof notifier.notify).toBe('function');
  });
});
