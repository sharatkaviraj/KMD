import { addDays, monthRange } from "@/vx/screens/academics/domain";
import { p, type Pair } from "@/vx/text";

/* Pure rules for the school calendar (tests/vx-calendar.test.ts). */

export type CalEvent = {
  id: string;
  kind: string;
  title: string;
  titleHi: string | null;
  startsOn: string;
  endsOn: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  place: string | null;
  classIds: string[];
  details: string | null;
  createdBy: string | null;
  cancelled: boolean;
};

export type CalHoliday = { id: string; day: string; kind: string; label: string | null; labelHi: string | null };

export const EVENT_KINDS = ["holiday", "exam", "event", "ptm", "meeting", "fee_due"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type GridDay = { day: string; inMonth: boolean; weekday: number };

/** The month as Monday-first weeks, padded with the neighbouring months' days. */
export function monthWeeks(month: string): GridDay[][] {
  const { first, last } = monthRange(month);
  const dow = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  let start = addDays(first, -dow(first));
  const end = addDays(last, 6 - dow(last));
  const weeks: GridDay[][] = [];
  while (start <= end) {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      week.push({ day, inMonth: day.slice(0, 7) === month, weekday: i });
    }
    weeks.push(week);
    start = addDays(start, 7);
  }
  return weeks;
}

/** Events on a day, timed ones in time order after the all-day ones. */
export function eventsOn(events: CalEvent[], day: string): CalEvent[] {
  return events
    .filter((e) => !e.cancelled && e.startsOn <= day && e.endsOn >= day)
    .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || (a.startsAt ?? "").localeCompare(b.startsAt ?? "") || a.title.localeCompare(b.title));
}

/** School days in a month: not Sunday, not a holiday or vacation. */
export function schoolDays(month: string, closed: Set<string>): number {
  const { first, last } = monthRange(month);
  let n = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const sunday = new Date(`${d}T12:00:00Z`).getUTCDay() === 0;
    if (!sunday && !closed.has(d)) n += 1;
  }
  return n;
}

/** Count per kind for the legend chips; holidays counted from the calendar days. */
export function kindCounts(events: CalEvent[], holidays: CalHoliday[]): Record<string, number> {
  const out: Record<string, number> = { holiday: holidays.filter((h) => h.kind === "holiday" || h.kind === "vacation").length };
  for (const e of events) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}

/** "Mon 5 Oct – Fri 9 Oct", "Sat 17 Oct · 12:00–13:30". */
export function whenLabel(e: Pick<CalEvent, "startsOn" | "endsOn" | "allDay" | "startsAt" | "endsAt">, fmt: (day: string) => string): string {
  const days = e.startsOn === e.endsOn ? fmt(e.startsOn) : `${fmt(e.startsOn)} – ${fmt(e.endsOn)}`;
  if (e.allDay || !e.startsAt) return days;
  return `${days} · ${e.startsAt}${e.endsAt ? `–${e.endsAt}` : ""}`;
}

/** The parent notice for a holiday, Hindi first. */
export function holidayNotice(label: string, labelHi: string | null, dayText: string): Pair {
  return p(`Dear parent, school will be closed on ${dayText} for ${label}.`, `प्रिय अभिभावक, ${labelHi || label} के अवसर पर ${dayText} को विद्यालय बंद रहेगा।`);
}

/** The parent notice for an event. */
export function eventNotice(e: Pick<CalEvent, "title" | "titleHi" | "place">, when: string): Pair {
  const place = e.place ? ` at ${e.place}` : "";
  const placeHi = e.place ? ` (${e.place})` : "";
  return p(`Dear parent, ${e.title} is on ${when}${place}. Please make sure your child attends.`, `प्रिय अभिभावक, ${e.titleHi || e.title} ${when}${placeHi} को है। कृपया ध्यान दें।`);
}
