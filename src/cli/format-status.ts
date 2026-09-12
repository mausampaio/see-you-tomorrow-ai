/**
 * Plain-text rendering for `seeya status` (D-028): the configured end-of-day time, the
 * discovered/eligible session counts, and — since S4-T13 — today's effective schedule and the
 * daemon's state, both pre-rendered by `./daemon-state.ts#describeDaemonState` and passed in as
 * `daemonAndScheduleReport`. That text is reused verbatim from the same function `seeya daemon
 * --status` calls (docs/PLANO-DE-ENTREGA.md S4-T13, cuidado (a)) rather than re-derived here —
 * this module's own job stays "assemble the pieces of `seeya status`'s report", not "decide what
 * the daemon is doing".
 */
export interface StatusView {
  readonly endOfDayTime: string | null;
  readonly discoveredSessionCount: number;
  readonly eligibleSessionCount: number;
  /** Pre-rendered by `./daemon-state.ts#describeDaemonState` — liveness, effective schedule
   * (adiamento/skip-today/already-ran folded in) and health, in that order, newline-joined. */
  readonly daemonAndScheduleReport: string;
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
    view.daemonAndScheduleReport,
  ].join('\n');
}
