/**
 * macOS native backend: `osascript -e 'display notification'` (docs/spikes/B-notificacoes.md §
 * macOS) — no actions (this task's contract has none, docs/ESPECIFICACAO.md § "Notificações"),
 * but always present on a real macOS host, unlike `terminal-notifier` (Spike B's action-capable
 * alternative: "binário externo, pode não estar instalado"). This adapter never uses
 * `terminal-notifier` at all — the one thing it would buy over `osascript` is actions, and that
 * capability is out of scope here. See docs/QUESTOES.md Q-038 for the write-up of that scope cut.
 */
import type { Notice } from '../../core/ports.js';
import type { CommandRunner, NotificationBackend } from './backend.js';
import { spawnCommand } from './backend.js';

/** Escapes `value` as an AppleScript double-quoted string literal body — backslash and the quote
 * itself are the only two characters that syntax treats specially. A literal newline isn't valid
 * inside one either, so it is flattened to a space rather than rejected: a notification body is a
 * short status line, not a document. */
function appleScriptStringLiteral(value: string): string {
  const singleLine = value.replace(/\r?\n/g, ' ');
  const escaped = singleLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Exported for direct unit testing of the AppleScript text without spawning anything. */
export function buildOsascriptArgs(notice: Notice): string[] {
  const script =
    `display notification ${appleScriptStringLiteral(notice.body)} ` +
    `with title ${appleScriptStringLiteral(notice.title)}`;
  return ['-e', script];
}

export interface MacOsascriptBackendOptions {
  readonly platform?: NodeJS.Platform;
  readonly command?: string;
  readonly run?: CommandRunner;
}

export class MacOsascriptBackend implements NotificationBackend {
  readonly name = 'macos-osascript';
  private readonly platform: NodeJS.Platform;
  private readonly command: string;
  private readonly run: CommandRunner;

  constructor(options: MacOsascriptBackendOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.command = options.command ?? 'osascript';
    this.run = options.run ?? spawnCommand;
  }

  /** Spike B: "sempre disponível" — no extra existence probe, unlike Linux's `notify-send`. */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.platform === 'darwin');
  }

  supportsActions(): boolean {
    return false;
  }

  async send(notice: Notice): Promise<void> {
    const result = await this.run(this.command, buildOsascriptArgs(notice));
    if (result.exitCode !== 0) {
      throw new Error(
        `osascript exited ${String(result.exitCode)}, expected 0. stderr: ${result.stderr || '(empty)'}`,
      );
    }
  }
}
