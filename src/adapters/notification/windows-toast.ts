/**
 * Windows native backend: a WinRT toast shown via PowerShell (docs/spikes/B-notificacoes.md §
 * Windows), the same dependency-free P/Invoke-adjacent technique
 * `adapters/process/console-signal.ts` uses for `CTRL_BREAK_EVENT` — no npm dependency, no
 * PowerShell module, no external binary.
 *
 * **Why `-EncodedCommand`, not a `-Command` string.** Same reasoning as
 * `console-signal.ts`'s own module comment, reused rather than re-litigated here: a `-Command`
 * string gets re-parsed by PowerShell itself after surviving `spawn`'s own argument handling,
 * which is exactly the kind of double-escaping that spike measured breaking. Base64 sidesteps
 * both: the script text is only ever decoded and run, never re-parsed as a command line.
 */
import type { Notice } from '../../core/ports.js';
import type { CommandRunner, NotificationBackend } from './backend.js';
import { spawnCommand } from './backend.js';

/** PowerShell's own AppUserModelID — Spike B measured a toast shown under this identity works
 * with zero registration, since PowerShell already owns it. */
const POWERSHELL_APP_ID =
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Escapes `value` for embedding inside a PowerShell single-quoted string literal — doubling `'`
 * is that syntax's only escape rule. Defensive rather than load-bearing today: `escapeXml` above
 * already turns any `'` in the notice's own text into `&apos;` before it gets here, so the toast
 * XML this wraps should never contain a literal single quote in practice — kept anyway (and
 * exported for its own direct test) so a future change to the XML shape can't silently reopen a
 * script-injection path. */
export function escapeForPowerShellSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''");
}

/** The toast's visual content — title + body, no `<actions>` element: this task's contract has
 * none (docs/ESPECIFICACAO.md § "Notificações"). Exported for direct unit testing of the XML shape
 * without going through the whole script. */
export function buildToastXml(notice: Notice): string {
  return (
    '<toast><visual><binding template="ToastGeneric">' +
    `<text>${escapeXml(notice.title)}</text>` +
    `<text>${escapeXml(notice.body)}</text>` +
    '</binding></visual></toast>'
  );
}

/**
 * The full PowerShell script: loads the two WinRT types explicitly (docs/spikes/B-notificacoes.md:
 * skipping either one fails with a `PSArgumentException` pointing at the wrong type) and shows the
 * toast under `POWERSHELL_APP_ID`.
 */
export function buildToastScript(notice: Notice): string {
  const xml = escapeForPowerShellSingleQuotedString(buildToastXml(notice));
  const appId = escapeForPowerShellSingleQuotedString(POWERSHELL_APP_ID);
  return `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml('${xml}')
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}')
$notifier.Show([Windows.UI.Notifications.ToastNotification]::new($doc))
`;
}

/** `powershell.exe -NoProfile -NonInteractive -NoLogo -EncodedCommand <base64>` — same argument
 * shape `console-signal.ts#runPowerShellScript` already uses. Exported so a test can assert on the
 * exact argument array, and decode the base64 back to confirm the script it wraps. */
export function buildPowerShellArgs(script: string): string[] {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encoded];
}

export interface WindowsToastBackendOptions {
  /** Defaults to `process.platform` — overridable so `isAvailable()` is testable on any host
   * (docs/PLANO-DE-ENTREGA.md S4-T1's own instruction, same seam
   * `adapters/process/termination.ts#terminateGracefully` already uses). */
  readonly platform?: NodeJS.Platform;
  /** Defaults to `'powershell.exe'`. Overridable so a test (or the e2e harness) can point this at
   * a fake executable instead of ever spawning the real one. */
  readonly command?: string;
  readonly run?: CommandRunner;
}

export class WindowsToastBackend implements NotificationBackend {
  readonly name = 'windows-toast';
  private readonly platform: NodeJS.Platform;
  private readonly command: string;
  private readonly run: CommandRunner;

  constructor(options: WindowsToastBackendOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.command = options.command ?? 'powershell.exe';
    this.run = options.run ?? spawnCommand;
  }

  /** Spike B measured this resolves with zero extra dependency on every Windows host tried — no
   * existence probe the way `LinuxNotifySendBackend` needs one (see that file's own docstring). */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.platform === 'win32');
  }

  supportsActions(): boolean {
    return false;
  }

  async send(notice: Notice): Promise<void> {
    const args = buildPowerShellArgs(buildToastScript(notice));
    const result = await this.run(this.command, args);
    if (result.exitCode !== 0) {
      throw new Error(
        `windows toast helper exited ${String(result.exitCode)}, expected 0. ` +
          `stderr: ${result.stderr || '(empty)'}`,
      );
    }
  }
}
