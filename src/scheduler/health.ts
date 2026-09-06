/**
 * Wires `core/daemon-health.ts`'s pure decision to `Storage`/`Notifier`/`Clock` — S4-T3b's answer to
 * docs/QUESTOES.md Q-049's item 9 ("nenhum registro de diagnóstico quando um poll falha"). The
 * error becomes STATE (`estado.json`), never a log this project still has nowhere to write (D-005:
 * `stdio` is `'ignore'`; AGENTS.md § "Registro e saída": no inventing a logger mid-task).
 *
 * Called from `scheduler/loop.ts`'s own `try`/`catch` around `pollOnce` — has to wrap the WHOLE
 * call, not live inside `poll.ts` itself, because a throw can happen at any point inside that
 * function and still needs a trace recorded no matter where it happened.
 */
import { localDayString } from '../core/day.js';
import { emptyDayState } from '../core/schedule.js';
import { recordCycleFailure, recordCycleSuccess } from '../core/daemon-health.js';
import type { DayState } from '../core/types.js';
import type { DaemonDeps } from './types.js';
import { buildDaemonUnhealthyNotice } from './notices.js';

/** Same idiom `adapters/storage/index.ts#readOneHandoffOrRejection` already uses for a caught,
 * untyped value (AGENTS.md § "Mensagens de erro": the raw failure, never just "it failed"). */
function describeCycleError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whatever `estado.json` currently holds, or a fresh day's worth of nothing (D-025: no poll has
 * ever run on this machine yet). Never applies `resetIfNewDay` itself — `daemonHealth` is exactly
 * the field that mustn't be reset by a day change (`core/schedule.ts#resetIfNewDay`'s own
 * docstring), and every OTHER field here is left exactly as `decideSchedule`'s own reset logic
 * already normalizes it on the next poll that needs to persist something. */
async function readCurrentState(deps: DaemonDeps): Promise<DayState> {
  const persisted = await deps.storage.readState();
  return persisted ?? emptyDayState(localDayString(deps.clock.now()));
}

/**
 * One poll that threw. Can itself reject (a `Storage`/`Notifier` failure while trying to record the
 * ORIGINAL failure) — this function does not swallow that on its own. `scheduler/loop.ts`'s own
 * `.catch(() => undefined)` at the call site is what makes it best-effort, the same shape it
 * already uses for `clearDaemonLock()` at shutdown: recording a failure must never be what actually
 * crashes the loop, but that guarantee belongs to the CALLER, so it stays visible in one place
 * rather than silently swallowed here where a test couldn't tell the difference between "nothing
 * went wrong" and "something did, but I hid it".
 */
export async function recordPollFailure(deps: DaemonDeps, error: unknown): Promise<void> {
  const state = await readCurrentState(deps);
  const { health, shouldNotify } = recordCycleFailure(
    state.daemonHealth,
    describeCycleError(error),
    deps.clock.now(),
  );
  await deps.storage.saveState({ ...state, daemonHealth: health });
  if (shouldNotify) {
    await deps.notifier.notify(buildDaemonUnhealthyNotice(health));
  }
}

/**
 * One poll that completed without throwing. Writes only when there was a failure streak to clear —
 * the overwhelmingly common "already healthy" poll costs nothing extra (docs/PLANO-DE-ENTREGA.md
 * S4-T3's own "não pode virar... enxurrada... de gasto", applied here to disk writes rather than
 * model calls).
 */
export async function recordPollSuccess(deps: DaemonDeps): Promise<void> {
  const state = await readCurrentState(deps);
  const health = recordCycleSuccess(state.daemonHealth);
  if (health === state.daemonHealth) {
    return;
  }
  await deps.storage.saveState({ ...state, daemonHealth: health });
}
