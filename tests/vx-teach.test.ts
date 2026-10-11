import { describe, expect, it } from "vitest";

import {
  absentAlert,
  absentOften,
  attentionReasons,
  average,
  copyYesterday,
  countMarks,
  dayBefore,
  leaveRuns,
  monthGrid,
  nextTap,
  periodPhases,
  phoneLinks,
  shiftMonth,
  upcomingBirthdays,
} from "@/vx/screens/teach/domain/teach";

describe("the register taps", () => {
  it("cycles present → absent → half-day → present", () => {
    expect(nextTap("present")).toBe("absent");
    expect(nextTap("absent")).toBe("half_day");
    expect(nextTap("half_day")).toBe("present");
    expect(nextTap(undefined)).toBe("absent");
  });

  it("sends an office mark back to present rather than inventing a step", () => {
    expect(nextTap("leave")).toBe("present");
    expect(nextTap("late")).toBe("present");
  });

  it("counts an unmarked child as present", () => {
    const c = countMarks(["a", "b", "c", "d"], { b: "absent", c: "half_day" });
    expect(c).toMatchObject({ present: 2, absent: 1, halfDay: 1, leave: 0, total: 4 });
  });

  it("copies yesterday for today's roll only, late becoming present", () => {
    expect(copyYesterday(["a", "b", "c"], { a: "absent", b: "late", z: "absent" })).toEqual({ a: "absent", b: "present", c: "present" });
  });
});

describe("the month view", () => {
  it("starts the grid on a Monday", () => {
    // 1 October 2026 is a Thursday: three blanks.
    const grid = monthGrid("2026-10");
    expect(grid.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[3]).toEqual({ day: "2026-10-01", date: 1, weekday: 4 });
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it("moves between months across a year", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });

  it("finds children absent often, most first", () => {
    const marks = [
      ...Array.from({ length: 4 }, () => ({ studentId: "a", status: "absent" as const })),
      ...Array.from({ length: 3 }, () => ({ studentId: "b", status: "absent" as const })),
      { studentId: "c", status: "absent" as const },
      { studentId: "c", status: "present" as const },
    ];
    expect(absentOften(marks)).toEqual([
      { studentId: "a", absent: 4 },
      { studentId: "b", absent: 3 },
    ]);
  });
});

describe("the day's periods", () => {
  const periods = [
    { period: 0, starts: "08:30", ends: "09:10" },
    { period: 2, starts: "09:50", ends: "10:30" },
    { period: 5, starts: "12:10", ends: "12:50" },
  ];

  it("marks done, now and the single next", () => {
    expect(periodPhases(periods, 10 * 60)).toEqual(["done", "now", "next"]);
    expect(periodPhases(periods, 8 * 60)).toEqual(["next", "later", "later"]);
    expect(periodPhases(periods, 15 * 60)).toEqual(["done", "done", "done"]);
  });
});

describe("birthdays", () => {
  const kids = [
    { id: "a", dateOfBirth: "2015-10-12" },
    { id: "b", dateOfBirth: "2014-10-10" },
    { id: "c", dateOfBirth: "2016-01-03" },
    { id: "d", dateOfBirth: null },
  ];

  it("finds the next week's birthdays, today first, with the age turned", () => {
    const found = upcomingBirthdays(kids, "2026-10-10");
    expect(found.map((k) => [k.id, k.inDays, k.turning])).toEqual([
      ["b", 0, 12],
      ["a", 2, 11],
    ]);
  });

  it("wraps into the next year", () => {
    expect(upcomingBirthdays(kids, "2025-12-30").map((k) => k.id)).toEqual(["c"]);
  });

  it("keeps a leap-day birthday on 28 February", () => {
    expect(upcomingBirthdays([{ dateOfBirth: "2016-02-29" }], "2027-02-27")[0]?.inDays).toBe(1);
  });
});

describe("children who need you", () => {
  it("names each reason", () => {
    expect(attentionReasons({ attendancePct: 70, daysCounted: 20, lowestSubjectPct: 30, openNotes: 2 })).toEqual(["attendance", "marks", "notes"]);
  });

  it("does not judge attendance on fewer than five days", () => {
    expect(attentionReasons({ attendancePct: 50, daysCounted: 3, lowestSubjectPct: null, openNotes: 0 })).toEqual([]);
  });

  it("averages to a whole percent", () => {
    expect(average([60, 71])).toBe(66);
    expect(average([])).toBeNull();
  });
});

describe("leave days", () => {
  it("joins contiguous days and bridges a Sunday", () => {
    // 10 Oct 2026 is a Saturday, 12 Oct a Monday.
    expect(leaveRuns(["2026-10-12", "2026-10-10", "2026-10-15", "2026-10-13"])).toEqual([
      { from: "2026-10-10", to: "2026-10-13" },
      { from: "2026-10-15", to: "2026-10-15" },
    ]);
  });

  it("drops bad input and duplicates", () => {
    expect(leaveRuns(["nope", "2026-10-20", "2026-10-20"])).toEqual([{ from: "2026-10-20", to: "2026-10-20" }]);
  });
});

describe("messages to parents", () => {
  it("writes the absent alert Hindi first and English beside it", () => {
    const text = absentAlert({ childName: "Test Child", classLabel: "Class 1", dayLabel: "10 Oct", school: "VPPS" });
    expect(text.hi).toContain("Test Child");
    expect(text.hi).toContain("स्कूल नहीं आए");
    expect(text.en).toContain("absent");
  });

  it("builds call and WhatsApp links from a ten-digit number", () => {
    expect(phoneLinks("+91 98765-43210")).toEqual({ tel: "tel:+919876543210", wa: "https://wa.me/919876543210" });
    expect(phoneLinks("123")).toBeNull();
  });
});
