/**
 * Local-calendar-day boundaries around an injected instant — the piece "commits do dia" needs
 * (docs/PLANO-DE-ENTREGA.md S2-T1) and the piece D-019 governs: `now` always arrives as a
 * parameter (from the `Clock` port, resolved by whoever calls `readFacts`), never read here.
 *
 * "Local" means the *getter* used is `getFullYear`/`getMonth`/`getDate` — JS's local-timezone
 * accessors — never `getUTCFullYear` etc. A commit made at 22:00 yesterday in the machine's
 * timezone is not "today" just because it already rolled over in UTC (the task that requested
 * this adapter names this exact case). `new Date(year, month, day[, ...])` is a deterministic
 * transformation of already-known values, not a clock read — permitted anywhere per D-019's
 * table.
 */
export interface LocalDayBounds {
  /** Local midnight at the start of `now`'s calendar day (inclusive). */
  readonly startOfToday: Date;
  /** Local midnight at the start of the following calendar day (exclusive upper bound). */
  readonly startOfTomorrow: Date;
}

export function localDayBounds(now: Date): LocalDayBounds {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Passing day+1 to the Date constructor rolls over month/year correctly on its own (e.g. day 32
  // of January becomes February 1st) — no separate month-end/leap-year handling needed here, and
  // the local-time semantics (including DST) come from the constructor the same way they do above.
  const startOfTomorrow = new Date(
    startOfToday.getFullYear(),
    startOfToday.getMonth(),
    startOfToday.getDate() + 1,
  );
  return { startOfToday, startOfTomorrow };
}

/** Whether `instant` falls within `bounds`' local day, `[startOfToday, startOfTomorrow)`. */
export function isWithinLocalDay(instant: Date, bounds: LocalDayBounds): boolean {
  return instant >= bounds.startOfToday && instant < bounds.startOfTomorrow;
}
