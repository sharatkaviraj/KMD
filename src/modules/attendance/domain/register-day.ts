import type { CalendarDayKind } from "@/modules/academics/domain/calendar";

/**
 * Why a day has no register, and where a teacher should go instead.
 *
 * "School is closed on this day, or it has not come yet" (20 Oct smoke run)
 * folded a holiday, a Sunday and a future day into one sentence and offered
 * no way out. Each of those is a different answer with a different next step,
 * so they are told apart here — pure, with no clock of its own: the caller
 * passes the school's today.
 */

/** A calendar row as the register needs it: the kind, and its name in both languages when one was typed. */
export type CalendarNote = { kind: CalendarDayKind; en: string | null; hi: string | null };

export type ClosedWhy =
  | { kind: "holiday" | "vacation"; en: string | null; hi: string | null }
  | { kind: "sunday" }
  | { kind: "future" }
  | { kind: "closed" };

/** What the register screen needs besides the register itself (built by its page). */
export type RegisterContext = {
  /** The school's today, by the reader's school clock. */
  today: string;
  /** Why this day has no register; null when it is open. */
  closedWhy: ClosedWhy | null;
  /** On a closed day, the last day school was open and whether its register is saved. */
  lastOpen: { day: string; marked: boolean } | null;
  /** The month's closed days that have a name ("Dussehra"). */
  holidays: Record<string, { en: string | null; hi: string | null }>;
  /** The month's open days before today with no saved register. */
  unmarked: string[];
  /** The reader's other classes (two or three at most) and whether this day's register is saved. */
  others: { classId: string; classLabel: string; marked: boolean }[];
};

/** What the class chooser shows: the day it is about, and each class's state that day. */
export type ChooserContext = {
  today: string;
  /** The day the rows open: the asked-for day, or the last open day when that one is closed. */
  day: string;
  closedWhy: ClosedWhy | null;
  /** classId → when that day's register was saved; null when not saved. */
  savedAt: Record<string, string | null>;
  sessionLabel: string;
};

const OPEN: Record<CalendarDayKind, boolean> = { instructional: true, holiday: false, exam: true, event: true, vacation: false };

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

function shift(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/** Open by the calendar when it has a row, else every day but Sunday (as `isSchoolOpen`). */
export function openOn(day: string, notes: ReadonlyMap<string, { kind: CalendarDayKind }>): boolean {
  const note = notes.get(day);
  if (note) return OPEN[note.kind];
  return weekday(day) !== 0;
}

/**
 * Why there is no register on `day`, or null when the register is open.
 * A day after the school's today is "future" whatever the calendar says —
 * a holiday next week is still a day that has not come.
 */
export function closedWhy(day: string, today: string, notes: ReadonlyMap<string, CalendarNote>): ClosedWhy | null {
  if (day > today) return { kind: "future" };
  if (openOn(day, notes)) return null;
  const note = notes.get(day);
  if (note && (note.kind === "holiday" || note.kind === "vacation")) {
    return { kind: note.kind, en: note.en?.trim() || null, hi: note.hi?.trim() || null };
  }
  if (weekday(day) === 0) return { kind: "sunday" };
  return { kind: "closed" };
}

/**
 * The last day school was open on or before `from`, looking back at most
 * `limit` days (a long vacation ends the search rather than the server).
 */
export function lastOpenDay(from: string, notes: ReadonlyMap<string, { kind: CalendarDayKind }>, limit = 40): string | null {
  let day = from;
  for (let i = 0; i <= limit; i += 1) {
    if (openOn(day, notes)) return day;
    day = shift(day, -1);
  }
  return null;
}

/**
 * The open school days of `month` up to and including `today` that have no
 * saved register — the days a class teacher still owes (smoke run: 12–17 Oct
 * showed only "·" and the average ignored them).
 */
export function unmarkedDays(input: {
  month: string;
  today: string;
  notes: ReadonlyMap<string, { kind: CalendarDayKind }>;
  marked: ReadonlySet<string>;
  /** Days before this one are not owed (the session or the child's class started later). */
  since?: string | null;
}): string[] {
  const [y, m] = input.month.split("-").map(Number);
  if (!y || !m) return [];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= days; d += 1) {
    const day = `${input.month}-${String(d).padStart(2, "0")}`;
    if (day > input.today) break;
    if (input.since && day < input.since) continue;
    if (!openOn(day, input.notes) || input.marked.has(day)) continue;
    out.push(day);
  }
  return out;
}

/**
 * Days grouped into runs of consecutive school days, so "12, 13, 14, 15, 16,
 * 17 Oct" reads as one run "12–17 Oct". A closed day between two days does not
 * break a run (Sunday sits inside most weeks).
 */
export function dayRuns(days: readonly string[], notes: ReadonlyMap<string, { kind: CalendarDayKind }>): { from: string; to: string; count: number }[] {
  const sorted = [...new Set(days)].sort();
  const runs: { from: string; to: string; count: number }[] = [];
  for (const day of sorted) {
    const last = runs[runs.length - 1];
    if (last) {
      let next = shift(last.to, 1);
      while (next < day && !openOn(next, notes)) next = shift(next, 1);
      if (next === day) {
        last.to = day;
        last.count += 1;
        continue;
      }
    }
    runs.push({ from: day, to: day, count: 1 });
  }
  return runs;
}
