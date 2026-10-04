/**
 * When each period happens, and whether one has started.
 *
 * The timetable says *what* is taught in period 3; it has never said *when*
 * period 3 is. Cover needs both: a cover for a lesson that started twenty
 * minutes ago is not a cover, it is an empty room with a notice about it, and
 * the after-first-period attendance reminder (P6) needs to know when the first
 * period ends.
 *
 * The school's own figures, from the Timetable2025 viewer's regular profile:
 * eight 40-minute periods from 08:30, a break 11:10–11:30, the day ending 14:10
 * (Raj, 4 October: the editable default). The six-period heatwave profile was
 * removed by its owner and is deliberately not here.
 *
 * Times are school wall-clock in Asia/Kolkata. India keeps no daylight saving,
 * so the offset is a constant and no time-zone library is needed — and a
 * server in UTC, a browser in Dubai and a teacher's phone all agree about what
 * 11:10 at school is.
 *
 * Pure: no database, no clock of its own. The caller passes `now`.
 */

export const SCHOOL_TIME_ZONE = "Asia/Kolkata";
const SCHOOL_OFFSET_MINUTES = 5 * 60 + 30;

export type BellPeriod = {
  /** 0-based, as `timetable_slots.period` stores it. */
  index: number;
  /** "HH:MM", school wall-clock. */
  starts: string;
  ends: string;
};

export type BellSchedule = {
  /** Null for the built-in default before a row exists. */
  id: string | null;
  label: string;
  periods: readonly BellPeriod[];
  /** Bumped on every edit, so a plan can say which bells it was made against. */
  revision: number;
};

export const DEFAULT_BELLS: BellSchedule = {
  id: null,
  label: "Regular",
  revision: 0,
  periods: [
    { index: 0, starts: "08:30", ends: "09:10" },
    { index: 1, starts: "09:10", ends: "09:50" },
    { index: 2, starts: "09:50", ends: "10:30" },
    { index: 3, starts: "10:30", ends: "11:10" },
    { index: 4, starts: "11:30", ends: "12:10" },
    { index: 5, starts: "12:10", ends: "12:50" },
    { index: 6, starts: "12:50", ends: "13:30" },
    { index: 7, starts: "13:30", ends: "14:10" },
  ],
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOf(hhmm: string): number | null {
  const match = HHMM.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function hhmmOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The school's calendar day and wall-clock minute for an instant. */
export function schoolClock(now: Date): { day: string; minutes: number } {
  const shifted = new Date(now.getTime() + SCHOOL_OFFSET_MINUTES * 60_000);
  return {
    day: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function periodWindow(
  schedule: BellSchedule,
  index: number,
): { starts: number; ends: number } | null {
  const period = schedule.periods.find((entry) => entry.index === index);
  if (!period) return null;
  const starts = minutesOf(period.starts);
  const ends = minutesOf(period.ends);
  return starts === null || ends === null ? null : { starts, ends };
}

export type PeriodTiming = "future" | "started" | "over" | "unknown";

/**
 * Where a period on a given school day stands at `now`.
 *
 * A day before today is over, a day after today is in the future, and today is
 * decided by the bells. A period the bells do not describe is `unknown` — the
 * caller treats it as needing a person to look, never as safely in the future.
 */
export function periodTiming(
  schedule: BellSchedule,
  day: string,
  index: number,
  now: Date,
): PeriodTiming {
  const clock = schoolClock(now);
  if (day < clock.day) return "over";
  if (day > clock.day) return "future";

  const window = periodWindow(schedule, index);
  if (!window) return "unknown";
  if (clock.minutes < window.starts) return "future";
  if (clock.minutes < window.ends) return "started";
  return "over";
}

/** Whether cover for this period can still be arranged before it begins. */
export function isArrangeable(
  schedule: BellSchedule,
  day: string,
  index: number,
  now: Date,
): boolean {
  return periodTiming(schedule, day, index, now) === "future";
}

/** When the first period of the day ends, in minutes — the register reminder's anchor. */
export function firstPeriodEnds(schedule: BellSchedule): number | null {
  const first = [...schedule.periods].sort((a, b) => a.index - b.index)[0];
  return first ? minutesOf(first.ends) : null;
}

export type BellProblem =
  | { kind: "bad_time"; index: number }
  | { kind: "ends_before_start"; index: number }
  | { kind: "overlaps_previous"; index: number }
  | { kind: "missing_period"; index: number }
  | { kind: "duplicate_period"; index: number };

/**
 * Why a set of bells cannot be saved, or nothing.
 *
 * Every period the timetable has must have a window; windows run forward and
 * do not overlap. Gaps between them are allowed — that is what a break is.
 */
export function bellProblems(periods: readonly BellPeriod[], periodCount: number): BellProblem[] {
  const problems: BellProblem[] = [];
  const seen = new Set<number>();

  for (const period of periods) {
    if (seen.has(period.index)) problems.push({ kind: "duplicate_period", index: period.index });
    seen.add(period.index);
  }
  for (let index = 0; index < periodCount; index += 1) {
    if (!seen.has(index)) problems.push({ kind: "missing_period", index });
  }

  const ordered = [...periods].sort((a, b) => a.index - b.index);
  let previousEnd: number | null = null;
  for (const period of ordered) {
    const starts = minutesOf(period.starts);
    const ends = minutesOf(period.ends);
    if (starts === null || ends === null) {
      problems.push({ kind: "bad_time", index: period.index });
      continue;
    }
    if (ends <= starts) problems.push({ kind: "ends_before_start", index: period.index });
    if (previousEnd !== null && starts < previousEnd) {
      problems.push({ kind: "overlaps_previous", index: period.index });
    }
    previousEnd = ends;
  }

  return problems;
}
