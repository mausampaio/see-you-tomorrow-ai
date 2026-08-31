/**
 * Linux native backend: `notify-send` (docs/spikes/B-notificacoes.md § Linux) — no `-A` (actions
 * are out of this task's contract, docs/ESPECIFICACAO.md § "Notificações").
 */
import type { Notice } from '../../core/ports.js';
import type { CommandRunner, NotificationBackend } from './backend.js';
import { spawnCommand } from './backend.js';

/** `shell: false` means these two elements reach `notify-send` verbatim, argv-separated — no shell
 * to interpret quotes/newlines/`&`, so unlike the macOS/Windows backends, there is nothing here to
 * escape (AGENTS.md § "Processos"). Exported for direct unit testing. */
export function buildNotifySendArgs(notice: Notice): string[] {
  return [notice.title, notice.body];
}

export interface LinuxNotifySendBackendOptions {
  readonly platform?: NodeJS.Platform;
  readonly command?: string;
  readonly run?: CommandRunner;
}

/**
 * Unlike the Windows/macOS backends, availability needs a real probe, not just a platform check:
 * Spike B is explicit that a server with no graphical session has none of this ("em servidor sem
 * sessão gráfica, nada disso existe") — `libnotify` itself may simply not be installed.
 * `--version` is a cheap, side-effect-free way to ask.
 */
export class LinuxNotifySendBackend implements NotificationBackend {
  readonly name = 'linux-notify-send';
  private readonly platform: NodeJS.Platform;
  private readonly command: string;
  private readonly run: CommandRunner;

  constructor(options: LinuxNotifySendBackendOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.command = options.command ?? 'notify-send';
    this.run = options.run ?? spawnCommand;
  }

  async isAvailable(): Promise<boolean> {
    if (this.platform !== 'linux') {
      return false;
    }
    try {
      const result = await this.run(this.command, ['--version']);
      return result.exitCode === 0;
    } catch {
      // ENOENT (binary missing) or any other spawn failure: no different from "not installed".
      return false;
    }
  }

  supportsActions(): boolean {
    return false;
  }

  async send(notice: Notice): Promise<void> {
    const result = await this.run(this.command, buildNotifySendArgs(notice));
    if (result.exitCode !== 0) {
      throw new Error(
        `notify-send exited ${String(result.exitCode)}, expected 0. stderr: ${result.stderr || '(empty)'}`,
      );
    }
  }
}
