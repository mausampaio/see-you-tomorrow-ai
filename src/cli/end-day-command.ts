/**
 * `seeya end-day [--dry-run] [--session <id|cwd>]` (docs/ESPECIFICACAO.md § `seeya end-day`).
 * Thin orchestration: builds `--session`'s matching predicate, calls `application/endDay`, and
 * turns the result into the plain-text report (`format-end-day.ts`). No I/O happens here directly
 * — `endDay` already did all of it (or, under `--dry-run`, stopped right before doing it).
 */
import { endDay } from '../application/end-day.js';
import type { EndDayDeps } from '../application/types.js';
import type { Config, DiscoveredSession } from '../core/types.js';
import { formatEndDayReport } from './format-end-day.js';

export interface EndDayCommandOptions {
  readonly dryRun: boolean;
  /** `--session <id|cwd>` (docs/ESPECIFICACAO.md): either the session's `sessionId` or its `cwd`,
   * matched by exact string equality — no path normalization, same convention
   * `core/eligibility.ts`'s `ignoredCwds` and `cli/session-view.ts`'s `projectPolicy` lookup
   * already use for `cwd`. `undefined` means no filter: every discovered session is in scope. */
  readonly session?: string;
}

/**
 * A plain predicate over `DiscoveredSession`, not a value `application/endDay` interprets itself —
 * `EndDayOptions.sessionFilter`'s own docstring explains why the two-way id-or-cwd match stays a
 * `cli/` concern instead of growing into `application/`.
 */
function buildSessionFilter(
  session: string | undefined,
): ((candidate: DiscoveredSession) => boolean) | undefined {
  if (session === undefined) {
    return undefined;
  }
  return (candidate) => candidate.sessionId === session || candidate.cwd === session;
}

/**
 * A `--session` value matching nothing is very likely a typo, not "zero eligible sessions" — the
 * ordinary, silent-is-fine case `formatEndDayReport` already handles for `--session`-less runs.
 * Reported distinctly instead of printing a report that would otherwise just say "0 in scope" with
 * no hint of why.
 */
function formatNoMatchMessage(session: string, discoveredCount: number): string {
  const discovered = `${discoveredCount} ${discoveredCount === 1 ? 'session was' : 'sessions were'}`;
  return (
    `No discovered session matches "${session}" (checked against sessionId and cwd). ` +
    `${discovered} discovered in total — see "seeya sessions" to list them.`
  );
}

export async function runEndDayCommand(
  deps: EndDayDeps,
  config: Config,
  options: EndDayCommandOptions,
): Promise<string> {
  const sessionFilter = buildSessionFilter(options.session);
  const result = await endDay(deps, {
    dryRun: options.dryRun,
    // `exactOptionalPropertyTypes`: omit the key entirely rather than assign `undefined` to it —
    // `EndDayOptions.sessionFilter` is typed as "a predicate, or absent", never "a predicate or
    // undefined".
    ...(sessionFilter !== undefined ? { sessionFilter } : {}),
  });
  if (options.session !== undefined && result.sessionsInScope === 0) {
    return formatNoMatchMessage(options.session, result.discoveredCount);
  }
  return formatEndDayReport(result, config);
}
