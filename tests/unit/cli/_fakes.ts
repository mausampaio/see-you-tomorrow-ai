/**
 * Named `Notifier` doubles for `cli/` tests (docs/TESTES.md: "duplo de I/O é classe/objeto nomeado
 * implementando a porta, não stub inline"). Local to `tests/unit/cli/` — no other test track needs
 * a `Notifier` fake today.
 */
import type { Notice, Notifier } from '../../../src/core/ports.js';

/** Records every `Notice` it was asked to show, in order — never throws. */
export class RecordingNotifier implements Notifier {
  readonly notices: Notice[] = [];

  notify(notice: Notice): Promise<void> {
    this.notices.push(notice);
    return Promise.resolve();
  }
}

/** Always rejects — proves a caller survives a broken `Notifier` (docs/core/ports.ts#Notifier:
 * "never rejects" is the CONTRACT; this fake exists to prove the CALLER doesn't just trust that
 * blindly). */
export class ThrowingNotifier implements Notifier {
  notify(): Promise<void> {
    return Promise.reject(new Error('ThrowingNotifier always rejects'));
  }
}
