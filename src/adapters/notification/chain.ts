/**
 * `Notifier` (`core/ports.ts`), implemented as Spike B's fallback chain
 * (docs/spikes/B-notificacoes.md § "Cadeia de fallback proposta") — docs/TESTES.md's exact
 * contract: "primeiro disponível vence; nenhum disponível cai para stderr sem lançar."
 *
 * `backends` is the ordered list of NATIVE options — one per OS today (Spike B's own "backend
 * nativo"/"backend degradado" split for macOS collapsed to a single `MacOsascriptBackend` once
 * actions left this task's contract; see `index.ts`'s own module comment and docs/QUESTOES.md
 * Q-038 for that scope cut). `StderrBackend` is NOT one of them — it is built into this class so
 * `notify()` can never throw regardless of what `backends` contains, including an empty array.
 */
import type { Notice, Notifier } from '../../core/ports.js';
import type { NotificationBackend } from './backend.js';
import { StderrBackend } from './stderr-backend.js';

/** A backend's own `isAvailable()` failing is itself just "not available" — same discipline D-003
 * already applies to a failed generation call, applied here to a failed capability probe: a broken
 * detector never takes the whole chain down with it. */
async function isAvailableSafely(backend: NotificationBackend): Promise<boolean> {
  try {
    return await backend.isAvailable();
  } catch {
    return false;
  }
}

/** `true` on success, `false` on any failure — including a backend that WAS available but whose
 * `send()` then threw (spawn error, non-zero exit). Either way, `ChainNotifier#notify` moves on to
 * the next backend rather than letting one flaky attempt end the whole notification. */
async function trySend(backend: NotificationBackend, notice: Notice): Promise<boolean> {
  try {
    await backend.send(notice);
    return true;
  } catch {
    return false;
  }
}

export class ChainNotifier implements Notifier {
  private readonly stderrBackend: NotificationBackend = new StderrBackend();

  constructor(private readonly backends: readonly NotificationBackend[]) {}

  async notify(notice: Notice): Promise<void> {
    for (const backend of this.backends) {
      if (!(await isAvailableSafely(backend))) {
        continue;
      }
      if (await trySend(backend, notice)) {
        return;
      }
    }
    // Guaranteed: StderrBackend.isAvailable() always resolves true and its send() never throws —
    // see that class's own docstring for why it is trusted where no other backend is.
    await this.stderrBackend.send(notice);
  }
}
