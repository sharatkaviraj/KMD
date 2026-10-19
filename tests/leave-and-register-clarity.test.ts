import { describe, expect, it } from "vitest";

import { markedLine } from "@/vx/screens/teach/domain/teach";
import { inboxBadgeCount } from "@/vx/shell/badge-count";
import { leavePeriods, leaveSpanFor, periodsNeedingCover, spanPeriods, type Slot } from "@/vx/screens/timetable/domain/timetable";

/*
 * B11: both teacher leave forms and the approval resolve a half day through
 * one resolver, so "First half" cannot be seven periods in one place and
 * three in another. B14: the register's banner follows the live marks.
 * Synthetic classes only.
 */

const MONDAY = "2026-10-19";
const TUESDAY = "2026-10-20";
// Stored period indexes: 0..7 for an eight-period day, break after index 3.
const mondaySlots = [
  { period: 0, classLabel: "QA 6" },
  { period: 2, classLabel: "QA 7A" },
  { period: 2, classLabel: "QA 7B" }, // a combined period: one period, two classes
  { period: 5, classLabel: "QA 8" },
  { period: 7, classLabel: "QA 6" },
];

describe("one leave resolver (B11)", () => {
  it("keeps a first half to periods 1–4 of the teacher's own day, a combined period once", () => {
    const [day] = leavePeriods([{ day: MONDAY, slots: mondaySlots }], "first_half");
    expect(day.periods.map((x) => x.number)).toEqual([1, 3]);
    expect(day.periods[1].classLabels).toEqual(["QA 7A", "QA 7B"]);
  });

  it("matches the approval's periods exactly (spanPeriods) for every span", () => {
    for (const span of ["full", "first_half", "second_half"] as const) {
      const [day] = leavePeriods([{ day: MONDAY, slots: mondaySlots }], span);
      const allowed = new Set(spanPeriods(span));
      expect(day.periods.every((x) => allowed.has(x.period))).toBe(true);
    }
    const [second] = leavePeriods([{ day: MONDAY, slots: mondaySlots }], "second_half");
    expect(second.periods.map((x) => x.number)).toEqual([6, 8]);
  });

  it("counts the same periods as the office's cover count", () => {
    const slots: Slot[] = mondaySlots.map((s) => ({ day: "Monday", period: s.period, classId: s.classLabel, classLabel: s.classLabel, subjectId: "sub", subjectCode: "SCI", staffProfileId: "t1", teacherShortName: "QA", parallel: false, shared: false }));
    const [day] = leavePeriods([{ day: MONDAY, slots: mondaySlots }], "first_half");
    expect(periodsNeedingCover(slots, "t1", MONDAY, MONDAY, "first_half")).toBe(day.periods.length);
  });

  it("says a day with no lessons plainly", () => {
    expect(leavePeriods([{ day: TUESDAY, slots: [] }], "first_half")).toEqual([{ day: TUESDAY, periods: [] }]);
  });

  it("asks a half day one day at a time and never silently halves several days", () => {
    expect(leaveSpanFor(1, "first_half")).toBe("first_half");
    expect(leaveSpanFor(2, "first_half")).toBe("full");
    expect(leaveSpanFor(3, "full")).toBe("full");
  });
});

describe("the register banner follows the marks (B14)", () => {
  it("names what is marked as soon as a child is absent", () => {
    expect(markedLine(27, 1, 0).en).toBe("Marked so far: 27 present, 1 absent.");
    expect(markedLine(25, 2, 1).en).toBe("Marked so far: 25 present, 2 absent, 1 half day or leave.");
    expect(markedLine(25, 2, 1).hi).toContain("2 अनुपस्थित");
  });
});

describe("leave waiting for a decision is in Needs you", () => {
  it("counts each asked leave once in the badge, and nothing when none is asked", () => {
    const none = { notMarked: false, coverNeeded: 0, changes: 0, confirmations: 0, refunds: 0, failedJobs: 0 };
    expect(inboxBadgeCount({ ...none, leave: 2 })).toBe(2);
    expect(inboxBadgeCount(none)).toBe(0);
  });
});
