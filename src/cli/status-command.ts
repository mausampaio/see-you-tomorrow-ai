/**
 * `seeya status` (docs/ESPECIFICACAO.md § "seeya status"), scoped down to what S1-T6 can honestly
 * answer today — see docs/QUESTOES.md Q-015 for what's deferred and why.
 */
import type { Clock, SessionProvider } from '../core/ports.js';
import type { Config } from '../core/types.js';
import { countEligibleSessions } from './eligibility-view.js';
import { formatStatusReport } from './format-status.js';

export interface StatusCommandContext {
  readonly sessionProvider: SessionProvider;
  readonly config: Config;
  readonly clock: Clock;
}

export async function runStatusCommand(context: StatusCommandContext): Promise<string> {
  const discovery = await context.sessionProvider.list();
  const now = context.clock.now();
  return formatStatusReport({
    endOfDayTime: context.config.endOfDayTime,
    discoveredSessionCount: discovery.sessions.length,
    eligibleSessionCount: countEligibleSessions(discovery.sessions, context.config, now),
  });
}
