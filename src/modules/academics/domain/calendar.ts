import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * The academic calendar — pure rules, no database.
 *
 * Only the days that are *not* an ordinary teaching day are stored, plus the
 * ones that are instructional against the weekly pattern. Absence of a row
 * means "whatever the weekly pattern says", so a year is a few dozen rows
 * rather than 365 — and adding a holiday is one insert, not a bulk edit.
 */

export const calendarDayKinds = [
  "instructional",
  "holiday",
  "exam",
  "event",
  "vacation",
] as const;

export type CalendarDayKind = (typeof calendarDayKinds)[number];

export const calendarKindLabels: Record<CalendarDayKind, Localized> = {
  instructional: t("पढ़ाई का दिन", "Teaching day"),
  holiday: t("अवकाश", "Holiday"),
  exam: t("परीक्षा", "Exam"),
  event: t("कार्यक्रम", "Event"),
  vacation: t("छुट्टियाँ", "Vacation"),
};

/**
 * Whether school is open on a day of this kind.
 *
 * `exam` and `event` are open: children come in, the register is taken, the
 * timetable simply does not run. Getting this wrong in the other direction
 * would mean an exam day with no attendance taken at all.
 */
export const KIND_IS_SCHOOL_OPEN: Record<CalendarDayKind, boolean> = {
  instructional: true,
  holiday: false,
  exam: true,
  event: true,
  vacation: false,
};

/** Whether the timetable's periods run on a day of this kind. */
export const KIND_RUNS_TIMETABLE: Record<CalendarDayKind, boolean> = {
  instructional: true,
  holiday: false,
  exam: false,
  event: false,
  vacation: false,
};

export type CalendarDay = {
  id: string;
  sessionLabel: string;
  /** ISO date, `YYYY-MM-DD`. */
  day: string;
  kind: CalendarDayKind;
  labelHi: string | null;
  labelEn: string | null;
};

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: encodeMessage(t("तारीख़ चुनें", "Choose a date")),
  });

const optionalLabel = z
  .string()
  .trim()
  .max(80, {
    message: encodeMessage(t("नाम बहुत लंबा है", "That name is too long")),
  })
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const calendarDaySchema = z
  .object({
    day: isoDate,
    /** Optional: set it to mark a range in one go. */
    until: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
        message: encodeMessage(t("तारीख़ चुनें", "Choose a date")),
      }),
    kind: z.enum(calendarDayKinds),
    labelHi: optionalLabel,
    labelEn: optionalLabel,
  })
  .refine((value) => value.until === null || value.until >= value.day, {
    message: encodeMessage(
      t(
        "आख़िरी तारीख़ पहली से पहले नहीं हो सकती",
        "The last date cannot be before the first",
      ),
    ),
    path: ["until"],
  });

export type CalendarDayInput = z.infer<typeof calendarDaySchema>;

/**
 * Every day from `day` to `until` inclusive.
 *
 * A vacation is entered once as a range and stored as one row per day: the
 * per-day row is what every other screen asks about ("is school open on the
 * 14th"), and a stored range would make that question a join.
 */
export function expandRange(day: string, until: string | null): string[] {
  if (!until || until === day) return [day];

  const days: string[] = [];
  const cursor = new Date(`${day}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);

  // A guard, not a limit anybody should hit: a mistyped year would otherwise
  // try to write four thousand rows.
  const MAX_DAYS = 400;

  while (cursor <= end && days.length < MAX_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

export const MAX_RANGE_DAYS = 400;

export function rangeIsTooLong(day: string, until: string | null): boolean {
  if (!until) return false;
  const start = new Date(`${day}T00:00:00Z`).getTime();
  const end = new Date(`${until}T00:00:00Z`).getTime();
  return (end - start) / 86_400_000 + 1 > MAX_RANGE_DAYS;
}

/**
 * Whether school is open on a given day.
 *
 * The calendar wins when it has an opinion; otherwise the weekly pattern
 * decides. Sunday is the school's weekly holiday — Saturday is a working day
 * here, which is the thing an imported calendar library would get wrong.
 */
export function isSchoolOpen(
  isoDay: string,
  calendar: Map<string, CalendarDayKind>,
): boolean {
  const kind = calendar.get(isoDay);
  if (kind) return KIND_IS_SCHOOL_OPEN[kind];

  return new Date(`${isoDay}T00:00:00Z`).getUTCDay() !== 0;
}

/** Whether the timetable runs — open is not the same as teaching. */
export function timetableRuns(
  isoDay: string,
  calendar: Map<string, CalendarDayKind>,
): boolean {
  const kind = calendar.get(isoDay);
  if (kind) return KIND_RUNS_TIMETABLE[kind];

  return new Date(`${isoDay}T00:00:00Z`).getUTCDay() !== 0;
}

export function calendarIndex(days: CalendarDay[]): Map<string, CalendarDayKind> {
  return new Map(days.map((entry) => [entry.day, entry.kind]));
}

/** Teaching days between two dates inclusive — the denominator of attendance %. */
export function countOpenDays(
  from: string,
  to: string,
  calendar: Map<string, CalendarDayKind>,
): number {
  return expandRange(from, to).filter((day) => isSchoolOpen(day, calendar)).length;
}

export function byDay(a: CalendarDay, b: CalendarDay): number {
  return a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
}

/** Group a session's days by month, for a screen that lists them. */
export function groupByMonth(days: CalendarDay[]): {
  month: string;
  days: CalendarDay[];
}[] {
  const groups = new Map<string, CalendarDay[]>();

  for (const entry of [...days].sort(byDay)) {
    const month = entry.day.slice(0, 7);
    const list = groups.get(month) ?? [];
    list.push(entry);
    groups.set(month, list);
  }

  return [...groups.entries()].map(([month, entries]) => ({
    month,
    days: entries,
  }));
}
