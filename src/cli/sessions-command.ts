/**
 * `seeya sessions` (docs/ESPECIFICACAO.md § "seeya sessions"): lists every discovered session
 * with its display state, last activity and end-of-day termination policy. Read-only — it never
 * writes anything, matching the spec's "é o comando de diagnóstico".
 */
import type { Clock, SessionProvider } from '../core/ports.js';
import type { Config } from '../core/types.js';
import { buildSessionRows } from './session-view.js';
import { formatSessionsReport } from './format-sessions.js';

export interface SessionsCommandContext {
  readonly sessionProvider: SessionProvider;
  readonly config: Config;
  readonly clock: Clock;
}

export async function runSessionsCommand(context: SessionsCommandContext): Promise<string> {
  const discovery = await context.sessionProvider.list();
  const rows = buildSessionRows(discovery.sessions, context.config, context.clock.now());
  return formatSessionsReport(rows, discovery.rejected);
}
