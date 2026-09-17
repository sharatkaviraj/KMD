import { t, type Localized } from "@/platform/i18n/language";

/**
 * Dates, in the school's own day.
 *
 * Every date this app stores is a plain `YYYY-MM-DD` — the day the school had,
 * not an instant. The subtlety is that the servers run in UTC and the school
 * runs in IST, so `new Date().toISOString().slice(0, 10)` is yesterday for
 * every moment between midnight and 05:30 in Barmer. A register opened at
 * 1 a.m. filed under the wrong date is the kind of bug nobody finds until a
 * month's totals are short by a day.
 *
 * India has no daylight saving, so a fixed offset is not an approximation
 * here — it is the whole rule.
 */

export const SCHOOL_UTC_OFFSET_MINUTES = 330;

/** The ISO day an instant falls on, in the school's timezone. */
export function toSchoolDay(instant: Date): string {
  const shifted = new Date(
    instant.getTime() + SCHOOL_UTC_OFFSET_MINUTES * 60_000,
  );
  return shifted.toISOString().slice(0, 10);
}

/** Today, as the school would say it. */
export function schoolToday(now: Date = new Date()): string {
  return toSchoolDay(now);
}

export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Rejects 2026-02-31, which the regex alone is happy with.
  return parsed.toISOString().slice(0, 10) === value;
}

/** 0 = Sunday, matching `Date.getUTCDay()`. */
export function weekdayIndex(isoDay: string): number {
  return new Date(`${isoDay}T00:00:00Z`).getUTCDay();
}

/**
 * The English weekday name.
 *
 * Not a label — this is the word the timetable sheet writes at the top of a
 * block, so it is matched against, not shown.
 */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function weekdayName(isoDay: string): string {
  return WEEKDAY_NAMES[weekdayIndex(isoDay)];
}

const WEEKDAY_LABELS: Localized[] = [
  t("रविवार", "Sunday"),
  t("सोमवार", "Monday"),
  t("मंगलवार", "Tuesday"),
  t("बुधवार", "Wednesday"),
  t("गुरुवार", "Thursday"),
  t("शुक्रवार", "Friday"),
  t("शनिवार", "Saturday"),
];

export function weekdayLabel(isoDay: string): Localized {
  return WEEKDAY_LABELS[weekdayIndex(isoDay)];
}

const MONTH_LABELS: Localized[] = [
  t("जनवरी", "January"),
  t("फ़रवरी", "February"),
  t("मार्च", "March"),
  t("अप्रैल", "April"),
  t("मई", "May"),
  t("जून", "June"),
  t("जुलाई", "July"),
  t("अगस्त", "August"),
  t("सितंबर", "September"),
  t("अक्तूबर", "October"),
  t("नवंबर", "November"),
  t("दिसंबर", "December"),
];

/** `2026-09` → "सितंबर 2026" / "September 2026". */
export function monthLabel(month: string): Localized {
  const index = Number(month.slice(5, 7)) - 1;
  const year = month.slice(0, 4);
  const name = MONTH_LABELS[index] ?? t(month, month);
  return t(`${name.hi} ${year}`, `${name.en} ${year}`);
}

/** `2026-09-17` → "17 सितंबर" / "17 September". */
export function dayLabel(isoDay: string): Localized {
  const index = Number(isoDay.slice(5, 7)) - 1;
  const date = String(Number(isoDay.slice(8, 10)));
  const name = MONTH_LABELS[index] ?? t(isoDay, isoDay);
  return t(`${date} ${name.hi}`, `${date} ${name.en}`);
}

/** The day of the month, for a register column header. */
export function dayOfMonth(isoDay: string): number {
  return Number(isoDay.slice(8, 10));
}

export function addDays(isoDay: string, delta: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function monthOf(isoDay: string): string {
  return isoDay.slice(0, 7);
}

export function monthBounds(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  // Day 0 of the next month is the last day of this one, which saves knowing
  // anything about February.
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, index, 0));
  return { from, to: last.toISOString().slice(0, 10) };
}

export function daysInMonth(month: string): string[] {
  const { from, to } = monthBounds(month);
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The previous month, `YYYY-MM` — for a register's "back" link. */
export function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const shifted = new Date(Date.UTC(year, index + delta, 1));
  return shifted.toISOString().slice(0, 7);
}
