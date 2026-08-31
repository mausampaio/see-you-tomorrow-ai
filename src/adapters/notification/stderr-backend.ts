/**
 * The guaranteed last resort in Spike B's fallback chain (docs/spikes/B-notificacoes.md § "Cadeia
 * de fallback proposta", item 3): plain text on `process.stderr`. Always available, and the only
 * backend `ChainNotifier` (`chain.ts`) trusts never to throw — every other backend depends on an
 * external command that can be missing, unauthorized, or simply fail.
 */
import type { Notice } from '../../core/ports.js';
import type { NotificationBackend } from './backend.js';

export class StderrBackend implements NotificationBackend {
  readonly name = 'stderr';

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  supportsActions(): boolean {
    return false;
  }

  send(notice: Notice): Promise<void> {
    process.stderr.write(`[seeya] ${notice.title}\n${notice.body}\n`);
    return Promise.resolve();
  }
}
