import { describe, expect, it } from "vitest";

import { eventNotice, eventsOn, holidayNotice, holidayRuns, kindCounts, monthWeeks, schoolDays, sessionMonths, visibleTo, whenLabel, type CalEvent } from "@/vx/screens/calendar/domain";

const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: "e",
  kind: "event",
  title: "Sports day",
  titleHi: null,
  startsOn: "2026-10-17",
  endsOn: "2026-10-17",
  allDay: true,
  startsAt: null,
  endsAt: null,
  place: null,
  classIds: [],
  details: null,
  createdBy: null,
  cancelled: false,
  ...over,
});

describe("month grid", () => {
  it("lays October 2026 out in Monday-first weeks", () => {
    const weeks = monthWeeks("2026-10");
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0].day).toBe("2026-09-28");
    expect(weeks[0][3]).toEqual({ day: "2026-10-01", inMonth: true, weekday: 3 });
    expect(weeks[4][6].day).toBe("2026-11-01");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("counts school days without Sundays and holidays", () => {
    expect(schoolDays("2026-10", new Set())).toBe(27);
    expect(schoolDays("2026-10", new Set(["2026-10-02", "2026-10-04"]))).toBe(26);
  });
});

describe("events", () => {
  it("puts all-day events first, then by time, and drops cancelled ones", () => {
    const list = [ev({ id: "b", allDay: false, startsAt: "12:00" }), ev({ id: "a", allDay: false, startsAt: "09:00" }), ev({ id: "c" }), ev({ id: "x", cancelled: true }), ev({ id: "range", startsOn: "2026-10-15", endsOn: "2026-10-18" })];
    expect(eventsOn(list, "2026-10-17").map((e) => e.id)).toEqual(["c", "range", "a", "b"]);
    expect(eventsOn(list, "2026-10-19")).toEqual([]);
  });

  it("labels when", () => {
    const fmt = (d: string) => d.slice(8);
    expect(whenLabel(ev({}), fmt)).toBe("17");
    expect(whenLabel(ev({ endsOn: "2026-10-18" }), fmt)).toBe("17 – 18");
    expect(whenLabel(ev({ allDay: false, startsAt: "12:00", endsAt: "13:30" }), fmt)).toBe("17 · 12:00–13:30");
  });

  it("counts kinds, holidays from the calendar days", () => {
    const counts = kindCounts([ev({}), ev({ kind: "exam" }), ev({ kind: "exam" })], [{ id: "h", day: "2026-10-02", kind: "holiday", label: "Gandhi Jayanti", labelHi: null }, { id: "i", day: "2026-10-03", kind: "instructional", label: null, labelHi: null }]);
    expect(counts).toEqual({ holiday: 1, event: 1, exam: 2 });
  });

  it("shows a class event only to readers of that class", () => {
    const e = ev({ classIds: ["c1"] });
    expect(visibleTo(e, false, new Set(["c2"]))).toBe(false);
    expect(visibleTo(e, false, new Set(["c1"]))).toBe(true);
    expect(visibleTo(e, true, new Set())).toBe(true);
    expect(visibleTo(ev({}), false, new Set())).toBe(true);
  });
});

describe("holidays", () => {
  it("folds consecutive days with one name into a run", () => {
    const runs = holidayRuns([
      { id: "1", day: "2026-10-21", kind: "vacation", label: "Diwali break", labelHi: null },
      { id: "2", day: "2026-10-20", kind: "vacation", label: "Diwali break", labelHi: null },
      { id: "3", day: "2026-10-22", kind: "vacation", label: "Diwali break", labelHi: null },
      { id: "4", day: "2026-11-05", kind: "holiday", label: "Test holiday", labelHi: null },
      { id: "5", day: "2026-11-06", kind: "exam_day", label: "Test holiday", labelHi: null },
    ]);
    expect(runs).toEqual([
      { from: "2026-10-20", to: "2026-10-22", kind: "vacation", label: "Diwali break", labelHi: null, days: 3 },
      { from: "2026-11-05", to: "2026-11-05", kind: "holiday", label: "Test holiday", labelHi: null, days: 1 },
    ]);
  });

  it("gives the session's months April to March, ignoring a prefix", () => {
    const months = sessionMonths("TEST-2026-27", "2026-10-10");
    expect(months[0]).toBe("2026-04");
    expect(months[11]).toBe("2027-03");
    expect(sessionMonths("odd", "2025-06-01")[0]).toBe("2025-04");
  });

  it("writes notices in both languages", () => {
    const h = holidayNotice("Diwali", "दीपावली", "2026-10-20", "2026-10-24");
    expect(h.hi).toContain("दीपावली");
    expect(h.en).toContain("from Tue 20 Oct to Sat 24 Oct");
    // A break ending on Saturday reopens on Monday, never on a Sunday.
    expect(h.en).toContain("opens as usual on Mon 26 Oct");
    const n = eventNotice({ kind: "ptm", title: "PTM", titleHi: null, startsOn: "2026-10-17", endsOn: "2026-10-17", allDay: false, startsAt: "11:00", place: "Hall" });
    expect(n.en).toContain("PTM is on Sat 17 Oct at 11:00 am, Hall");
    expect(n.hi).toContain("Hall में");
    expect(eventNotice({ kind: "meeting", title: "Staff meeting", titleHi: null, startsOn: "2026-10-10", endsOn: "2026-10-10", allDay: true, startsAt: null, place: null }, "staff").en).toMatch(/^Dear colleagues,/);
  });
});
