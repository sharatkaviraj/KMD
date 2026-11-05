/**
 * "Paid on" (plan §3.3 card 4): a 7-day strip ending today, and a month grid
 * for earlier days. Future days and days before the session cannot be picked
 * (D6). Dates are YYYY-MM-DD in the school's calendar; arithmetic is in UTC
 * so no timezone moves a day.
 */

const DAY = 86_400_000;

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const t = utc(value);
  return Number.isFinite(t) && iso(t) === value;
}

export function addDays(date: string, days: number): string {
  return iso(utc(date) + days * DAY);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY);
}

/** 0 Sunday … 6 Saturday. */
export function weekday(date: string): number {
  return new Date(utc(date)).getUTCDay();
}

/** The strip: the six days before today, then today. */
export function dateStrip(today: string, length = 7): string[] {
  return Array.from({ length }, (_, i) => addDays(today, i - (length - 1)));
}

export type DateRule = { today: string; sessionStart: string };

export function datePickable(date: string, rule: DateRule): boolean {
  return isIsoDate(date) && date <= rule.today && date >= rule.sessionStart;
}

export function isBackdated(date: string, today: string): boolean {
  return date < today;
}

/** One step left or right on the strip (arrow keys), refused past today or before the session. */
export function stepDate(date: string, by: -1 | 1, rule: DateRule): string {
  const next = addDays(date, by);
  return datePickable(next, rule) ? next : date;
}

export type MonthCell = { date: string; day: number; pickable: boolean; today: boolean } | null;

/** A month as 6 weeks of 7 cells (Sunday first), blanks as null. `month` is YYYY-MM. */
export function monthGrid(month: string, rule: DateRule): MonthCell[] {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const start = weekday(first);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: MonthCell[] = Array.from({ length: start }, () => null);
  for (let d = 1; d <= days; d += 1) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    cells.push({ date, day: d, pickable: datePickable(date, rule), today: date === rule.today });
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return iso(Date.UTC(y, m - 1 + by, 1)).slice(0, 7);
}

/** Whether the month grid may move to the previous / next month. */
export function monthBounds(month: string, rule: DateRule): { prev: boolean; next: boolean } {
  return { prev: month > rule.sessionStart.slice(0, 7), next: month < rule.today.slice(0, 7) };
}
