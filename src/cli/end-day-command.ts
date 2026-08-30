/**
 * `seeya end-day [--dry-run] [--session <value>]` (docs/ESPECIFICACAO.md § `seeya end-day`,
 * extended by docs/PLANO-DE-ENTREGA.md S3-T5). Resolves `--session` to at most one discovered
 * session BEFORE `application/endDay` ever runs (`cli/session-reference.ts`), then calls `endDay`
 * with an exact-`sessionId` filter and turns the result into the plain-text report
 * (`format-end-day.ts`). No I/O happens here directly beyond that one resolving discovery call —
 * everything else `endDay` already did (or, under `--dry-run`, stopped right before doing it).
 *
 * **Why resolve before calling `endDay`, instead of passing a looser predicate straight through
 * like before S3-T5.** `EndDayOptions.sessionFilter` narrows AFTER `endDay`'s own discovery, at
 * which point captures (and, for `canTerminate: true` sessions, process termination, D-002) have
 * already happened for anything the predicate let through. A predicate that could match more than
 * one session — `candidate.cwd === session`, when dozens of sessions share a `cwd`, is exactly the
 * case S3-T5 exists for — would silently capture (and potentially terminate) all of them with no
 * chance to object first. Resolving here, against a fresh discovery snapshot, is what makes
 * ambiguity refusable instead of already-acted-on.
 */
import { endDay } from '../application/end-day.js';
import type { EndDayDeps } from '../application/types.js';
import type { Config, DiscoveredSession } from '../core/types.js';
import { normalizeCwdForComparison, type PathPlatformHint } from '../core/cwd-normalization.js';
import { resolveSessionReference, type SessionReference } from './session-reference.js';
import { formatEndDayReport } from './format-end-day.js';

export interface EndDayCommandOptions {
  readonly dryRun: boolean;
  /**
   * `--session <value>` (docs/ESPECIFICACAO.md, matching rules extended by S3-T5): the session's
   * full `sessionId`, a `sessionId` prefix, its display `name`, or its `cwd` — path-normalized
   * (`core/cwd-normalization.ts`), not exact string equality, so separator style, trailing
   * separator, and (Windows only) case no longer cause a real match to silently miss.
   * `undefined` means no filter: every discovered session is in scope.
   */
  readonly session?: string;
}

/** Real environment read once, here — `cli/` is the composition root (D-020), the one place
 * allowed to resolve `process.platform` into a normalization hint for `core/`. */
const PLATFORM_HINT: PathPlatformHint = process.platform === 'win32' ? 'win32' : 'posix';

function toSessionReference(session: DiscoveredSession): SessionReference {
  return { sessionId: session.sessionId, cwd: session.cwd, name: session.name };
}

/**
 * `--session`'s "no match" report. A very likely typo, not "zero eligible sessions" — the
 * ordinary, silent-is-fine case `formatEndDayReport` already handles for `--session`-less runs.
 *
 * **Always shows the RAW value `--session` received, never a silently normalized stand-in for
 * it** (docs/PLANO-DE-ENTREGA.md S3-T5: the maintainer typed `C:\Users\<usuario>` in a Git Bash shell
 * that ate the backslashes before `seeya` ever saw the argument, and the old message — "doesn't
 * match anything" — never let him see that `C:Users<usuario>` was what actually arrived). `seeya` has
 * no way to know what was typed, only what arrived; showing that value plainly, unmodified, is
 * what lets a person notice for themselves that it isn't what they expect. When treating it as a
 * `cwd` candidate would have changed it (separator, Windows case-folding, a trailing separator),
 * the normalized form is shown too — proof that path normalization was tried and still found no
 * match, not silence about whether it was attempted at all.
 */
function formatNoMatchMessage(session: string, discoveredCount: number): string {
  const discovered = `${discoveredCount} ${discoveredCount === 1 ? 'session was' : 'sessions were'}`;
  const normalized = normalizeCwdForComparison(session, PLATFORM_HINT);
  const normalizedNote =
    normalized === session ? '' : ` (normalized to "${normalized}" for a cwd comparison)`;
  return (
    `No discovered session matches "${session}"${normalizedNote} ` +
    '(checked against sessionId, a sessionId prefix, the display name, and cwd). ' +
    `${discovered} discovered in total — see "seeya sessions" to list them.`
  );
}

/**
 * D-025 applied to a choice with real consequences: `--session` can terminate the process it
 * resolves to (D-002), so two or more matching sessions is refused outright, never narrowed to one
 * by guessing (docs/PLANO-DE-ENTREGA.md S3-T5's hard rule: "prefixo ambíguo nunca escolhe
 * sozinho"). Every match is named by its full `sessionId` — the one value guaranteed to resolve
 * unambiguously on a retry (`cli/session-reference.ts`'s first, authoritative matching stage).
 */
function formatAmbiguousMatchMessage(
  session: string,
  matches: readonly DiscoveredSession[],
): string {
  const lines = [
    `"${session}" matches ${matches.length} discovered sessions — refusing to guess which one:`,
    ...matches.map((match) => `  - ${match.name} (${match.cwd}) — sessionId ${match.sessionId}`),
    'Retype --session with the full sessionId shown above to pick one.',
  ];
  return lines.join('\n');
}

/**
 * The rare race a two-step resolve-then-run introduces: the session `resolveSessionReference`
 * found in this command's own discovery call ended (or otherwise stopped being eligible) before
 * `endDay`'s own, separate discovery call ran moments later. Distinct from `formatNoMatchMessage`
 * — the VALUE matched something real a moment ago, so "no discovered session matches" would be
 * false — and distinct from a normal empty report, which `formatEndDayReport` already renders
 * honestly on its own (D-025: don't claim more than what's known).
 */
function formatVanishedMatchMessage(session: string, resolvedName: string): string {
  return (
    `"${session}" matched "${resolvedName}" moments ago, but it was no longer discovered when ` +
    'end-day ran — it may have ended in between. Run "seeya sessions" and try again.'
  );
}

export async function runEndDayCommand(
  deps: EndDayDeps,
  config: Config,
  options: EndDayCommandOptions,
): Promise<string> {
  if (options.session === undefined) {
    const result = await endDay(deps, { dryRun: options.dryRun });
    return formatEndDayReport(result, config);
  }
  const discovery = await deps.sessionProvider.list();
  const match = resolveSessionReference(discovery.sessions, toSessionReference, options.session);
  if (match.kind === 'notFound') {
    return formatNoMatchMessage(options.session, discovery.sessions.length);
  }
  if (match.kind === 'ambiguous') {
    return formatAmbiguousMatchMessage(options.session, match.matches);
  }
  const resolvedSessionId = match.item.sessionId;
  const result = await endDay(deps, {
    dryRun: options.dryRun,
    sessionFilter: (candidate) => candidate.sessionId === resolvedSessionId,
  });
  if (result.sessionsInScope === 0) {
    return formatVanishedMatchMessage(options.session, match.item.name);
  }
  return formatEndDayReport(result, config);
}
