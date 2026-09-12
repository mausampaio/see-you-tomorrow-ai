/**
 * `seeya status` (docs/ESPECIFICACAO.md § "seeya status") — the single-panel answer to "what's
 * going to happen today, and is the daemon handling it" (S4-T13, decision from
 * docs/QUESTOES.md Q-056 item 4, closing the gap Q-015 (S1-T6) left open). Read-only throughout:
 * this command never persists anything and never clears a stale lock (that's `seeya daemon
 * --stop`'s job) — see `./daemon-state.ts#describeDaemonState`'s own docstring for the read-only
 * discipline this delegates to.
 *
 * **The daemon/schedule section comes from the exact same function `seeya daemon --status` calls**
 * (`./daemon-state.ts#describeDaemonState`), over the same `Storage`/`ProcessControl`/`Clock` —
 * not a second interpretation of the same state. This is what the acceptance criterion means by
 * "os dois nunca podem discordar sobre o daemon": one implementation, two callers, not a
 * convention two implementations happen to follow (`tests/unit/cli/daemon-status-agreement.test.ts`).
 */
import type { Clock, ProcessControl, SessionProvider, Storage } from '../core/ports.js';
import type { Config } from '../core/types.js';
import { countEligibleSessions } from './eligibility-view.js';
import { formatStatusReport } from './format-status.js';
import { describeDaemonState } from './daemon-state.js';

export interface StatusCommandContext {
  readonly sessionProvider: SessionProvider;
  readonly config: Config;
  readonly clock: Clock;
  readonly storage: Storage;
  readonly processControl: ProcessControl;
}

export async function runStatusCommand(context: StatusCommandContext): Promise<string> {
  const discovery = await context.sessionProvider.list();
  const now = context.clock.now();
  // One liveness check for the whole command (docs/PLANO-DE-ENTREGA.md S4-T13, cuidado (g)) —
  // `describeDaemonState` itself only calls `ProcessControl.isAlive` once; nothing here calls it
  // again.
  const daemonAndScheduleReport = await describeDaemonState(context);
  return formatStatusReport({
    endOfDayTime: context.config.endOfDayTime,
    discoveredSessionCount: discovery.sessions.length,
    eligibleSessionCount: countEligibleSessions(discovery.sessions, context.config, now),
    daemonAndScheduleReport,
  });
}
