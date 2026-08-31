/**
 * Notification adapter: native per-OS toast, implements `Notifier` (`core/ports.ts`,
 * docs/ARQUITETURA.md, docs/PLANO-DE-ENTREGA.md S4-T1).
 *
 * Spike B's fallback chain (docs/spikes/B-notificacoes.md § "Cadeia de fallback proposta"): one
 * native backend per OS, degrading to `StderrBackend` when nothing is available or every attempt
 * fails (`chain.ts#ChainNotifier`, docs/TESTES.md § "Cadeia de fallback do notificador").
 *
 * **No action buttons** (docs/ESPECIFICACAO.md § "Notificações"): the contract is title + body
 * only. Spike B's own chain sketched a SECOND, action-capable tier per OS (`terminal-notifier` on
 * macOS, `notify-send -A` on Linux, WinRT's `activationType="protocol"` on Windows) — cut here
 * because nothing in this task's contract depends on a click, and `terminal-notifier` specifically
 * would add an external binary "que pode não estar instalado" for a capability nothing uses yet.
 * See docs/QUESTOES.md Q-038 and `scripts/validate-windows-toast-protocol.mjs` for the one piece
 * of that cut tier docs/PLANO-DE-ENTREGA.md still asks to prepare: manual validation of Windows'
 * `activationType="protocol"`, which only a human at a real desktop can do.
 *
 * Everything else in this directory (`backend.ts`, `chain.ts`, `stderr-backend.ts`,
 * `windows-toast.ts`, `macos-osascript.ts`, `linux-notify-send.ts`) is this module's own internal
 * wiring — not re-exported, same "adapter's public surface is its `index.ts`" convention
 * `adapters/discovery/index.ts`/`adapters/generation/index.ts` already follow. Tests import the
 * specific file they need directly.
 */
import type { Notifier } from '../../core/ports.js';
import type { NotificationBackend } from './backend.js';
import { ChainNotifier } from './chain.js';
import { WindowsToastBackend } from './windows-toast.js';
import { MacOsascriptBackend } from './macos-osascript.js';
import { LinuxNotifySendBackend } from './linux-notify-send.js';

/**
 * One native backend per OS. `platform` defaults to `process.platform` but is overridable — same
 * default-parameter seam `adapters/process/termination.ts#terminateGracefully` already uses — so
 * this factory itself stays unit-testable without depending on which OS actually runs the test
 * (the S2-T1 lesson: a test that only passes on one OS hides a defect on the other two). An
 * unrecognized `platform` returns no native backend at all: `ChainNotifier` still works, falling
 * straight to its own built-in stderr fallback.
 */
export function buildDefaultBackends(
  platform: NodeJS.Platform = process.platform,
): NotificationBackend[] {
  if (platform === 'win32') {
    return [new WindowsToastBackend()];
  }
  if (platform === 'darwin') {
    return [new MacOsascriptBackend()];
  }
  if (platform === 'linux') {
    return [new LinuxNotifySendBackend()];
  }
  return [];
}

/** Ready-to-use singleton, same convention `adapters/process/index.ts#processControl` already
 * established — `cli/` (D-020) imports this directly rather than constructing the chain itself. */
export const notifier: Notifier = new ChainNotifier(buildDefaultBackends());
