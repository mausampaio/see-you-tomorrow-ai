/**
 * Plain-text rendering for `seeya status` (D-028). See docs/QUESTOES.md Q-015 for what this
 * command doesn't show yet — time remaining until end-of-day, snooze/skip-today state, daemon
 * status — and why: none of `core/schedule` (S4-T2), `seeya snooze`/`skip-today` (S4-T4) or the
 * daemon (S4-T3) exist yet, and inventing their output here would be exactly the kind of
 * unspecified behavior AGENTS.md forbids.
 */
export interface StatusView {
  readonly endOfDayTime: string | null;
  readonly discoveredSessionCount: number;
  readonly eligibleSessionCount: number;
}

function formatEndOfDayLine(endOfDayTime: string | null): string {
  return endOfDayTime === null
    ? 'End-of-day time: not configured (manual only)'
    : `End-of-day time: ${endOfDayTime} local`;
}

export function formatStatusReport(view: StatusView): string {
  return [
    formatEndOfDayLine(view.endOfDayTime),
    `Eligible sessions: ${view.eligibleSessionCount} of ${view.discoveredSessionCount} discovered`,
    'Daemon: not implemented yet',
  ].join('\n');
}
