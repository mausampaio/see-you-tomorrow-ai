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
