/**
 * Local calendar-day formatting (docs/ARQUITETURA.md § "Fusos e horários"): the day a handoff
 * belongs to is the LOCAL calendar day at capture time, matching `~/.seeya/days/<YYYY-MM-DD>/`
 * (docs/ESPECIFICACAO.md § "Formato do handoff") — never UTC, never an epoch. Pure formatting of
 * an already-resolved `Date` (D-019: the instant itself comes from the `Clock` port, never read
 * here).
 */
import type { Day } from './types.js';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `"YYYY-MM-DD"` for `instant`'s local calendar day. Same field extraction
 * `adapters/git/local-day.ts#localDayBounds` uses for day boundaries, kept as a separate, smaller
 * primitive here on purpose: that one lives in `adapters/git/`, which `application/` cannot import
 * (D-020's layer matrix), and it answers a different question (the day's start/end instants, for
 * filtering commits) than the one `application/endDay` needs (a display/path string for
 * `~/.seeya/days/<Day>/`).
 */
export function localDayString(instant: Date): Day {
  return `${instant.getFullYear()}-${pad2(instant.getMonth() + 1)}-${pad2(instant.getDate())}`;
}

/**
 * `instant`'s local calendar day, `days` days earlier — a deterministic transformation of an
 * already-resolved `Date` (D-019: no clock read here), added for
 * `application/find-pending-briefing.ts` (S3-T1) to walk backward one local day at a time
 * looking for `seeya start-day`'s "briefing mais recente que ainda tem pendências"
 * (docs/ESPECIFICACAO.md).
 *
 * Built from the local `Y`/`M`/`D` fields, not `instant.getTime() - days * 86_400_000`:
 * subtracting milliseconds mishandles a daylight-saving transition that falls inside the range (a
 * local day that isn't 24h long), while handing the `Date` constructor an out-of-range
 * day-of-month normalizes correctly across month and year boundaries.
 *
 * @example
 * subtractLocalDays(new Date(2026, 0, 1), 1) // 2025-12-31, same local time-of-day
 */
export function subtractLocalDays(instant: Date, days: number): Date {
  return new Date(
    instant.getFullYear(),
    instant.getMonth(),
    instant.getDate() - days,
    instant.getHours(),
    instant.getMinutes(),
    instant.getSeconds(),
    instant.getMilliseconds(),
  );
}
