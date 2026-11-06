/**
 * "Refresh roster now" (owner decision, 6 Nov 2026): the roster is copied
 * from Fees once a night (D-457), and an admin may ask for the day's changes
 * by hand. Never on a schedule, and never more often than this: the
 * every-minute copy is what overloaded the database on 6 Nov.
 */
export const ROSTER_REFRESH_COOLDOWN_MS = 10 * 60_000;

/** Milliseconds until another refresh is allowed; 0 when it is allowed now. */
export function rosterRefreshWait(lastTimes: ReadonlyArray<string | null | undefined>, now = Date.now()): number {
  const latest = Math.max(0, ...lastTimes.map((t) => Date.parse(t ?? "")).filter(Number.isFinite));
  return Math.max(0, latest + ROSTER_REFRESH_COOLDOWN_MS - now);
}
