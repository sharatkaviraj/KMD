import { describe, expect, it } from "vitest";

import { teacherCoverTally } from "@/modules/substitutions/domain/cover-view";
import { coverStanding, coverToday, uncoveredLessons } from "@/vx/screens/admin/schedule";
import { coverRing, leaveApprovedMessage, leaveLeftShort, periodsNeedingCover, type Slot } from "@/vx/screens/timetable/domain/timetable";

/* School-day run, 20 Oct: cover said "arranged" and drew green while three periods had no teacher. */

const T1 = "t-away";
const need = (key: string, period: number, absent = [T1]) => ({ key, event: { period } as never, absentStaffIds: absent });

describe("teacherCoverTally", () => {
  it("counts covered, waiting and begun-with-nobody for one teacher", () => {
    const needs = [need("a", 1), need("b", 2), need("c", 3), need("d", 4), need("x", 5, ["other"])];
    const live = [
      { needKey: "a", status: "assigned" },
      { needKey: "b", status: "needs_help" },
    ];
    // P3 is still open with no duty (waiting); P4 has begun with none (missed).
    expect(teacherCoverTally(needs, live, new Set([1, 2, 3]), T1)).toEqual({ needed: 4, covered: 1, waiting: 2, missed: 1 });
  });

  it("a team block split into parts is covered only when every part is", () => {
    const live = [
      { needKey: "t-1", status: "assigned" },
      { needKey: "t-2", status: "needs_help" },
    ];
    expect(teacherCoverTally([need("t", 2)], live, new Set([2]), T1)).toEqual({ needed: 1, covered: 0, waiting: 1, missed: 0 });
  });
});

describe("leaveApprovedMessage", () => {
  const base = { needed: 0, covered: 0, waiting: 0, missed: 0, byHand: 0, closed: 0 };

  it("never says arranged when nothing was covered", () => {
    const o = { ...base, needed: 3, missed: 3 };
    const m = leaveApprovedMessage(o);
    expect(m.en).toBe("Leave approved · 0 of 3 periods have a teacher · 3 had already begun, with no teacher");
    expect(m.hi).toContain("3 में से 0");
    expect(m.en).not.toMatch(/arranged/);
    expect(leaveLeftShort(o)).toBe(true);
  });

  it("says all covered only when every lesson has a teacher", () => {
    const o = { ...base, needed: 2, covered: 2 };
    expect(leaveApprovedMessage(o).en).toBe("Leave approved · all 2 periods have a teacher");
    expect(leaveLeftShort(o)).toBe(false);
  });

  it("a holiday needs no cover, and says why", () => {
    expect(leaveApprovedMessage({ ...base, closed: 1 }).en).toBe("Leave approved · school is closed then, no cover needed");
  });

  it("names waiting lessons and days left for a person", () => {
    const m = leaveApprovedMessage({ ...base, needed: 4, covered: 1, waiting: 3, byHand: 2 });
    expect(m.en).toContain("3 waiting for you to choose a teacher");
    expect(m.en).toContain("2 days to arrange by hand");
    expect(m.hi).toContain("4 में से 1");
  });
});

describe("coverRing", () => {
  it("0/0 is grey, not a full green ring", () => {
    expect(coverRing(0, 0, 0)).toEqual({ total: 0, short: 0, tone: "none" });
  });
  it("begun periods count in the denominator and turn it to warn", () => {
    expect(coverRing(0, 0, 3)).toEqual({ total: 3, short: 3, tone: "warn" });
    expect(coverRing(2, 2, 1)).toEqual({ total: 3, short: 1, tone: "warn" });
  });
  it("green only when every lesson has a teacher", () => {
    expect(coverRing(2, 2, 0)).toEqual({ total: 2, short: 0, tone: "ok" });
  });
});

describe("Today's cover figures", () => {
  const slots = [
    { period: 1, staffProfileId: T1, shared: false },
    { period: 2, staffProfileId: T1, shared: false },
    { period: 3, staffProfileId: T1, shared: false },
    { period: 3, staffProfileId: T1, shared: false }, // a combined class: one lesson
    { period: 4, staffProfileId: T1, shared: true },
    { period: 2, staffProfileId: "present", shared: false },
  ];

  it("a teacher away with no duties is not 'No cover needed'", () => {
    const absences = [{ staffProfileId: T1, periods: [0, 1, 2, 3, 4] }];
    expect(uncoveredLessons(slots, [], absences)).toBe(3);
    const cover = coverToday([], slots, absences);
    expect(cover).toEqual({ needed: 3, arranged: 0, missed: 3 });
    expect(coverStanding(cover)).toEqual({ short: 3, tone: "warn" });
  });

  it("a lesson with a live duty is not missed, and an empty period list is the whole day", () => {
    const duties = [{ period: 1, absentStaffIds: [T1], status: "assigned" as const }];
    const cover = coverToday(duties, slots, [{ staffProfileId: T1, periods: [] }]);
    expect(cover).toEqual({ needed: 3, arranged: 1, missed: 2 });
  });

  it("nothing needed is 'none', all covered is ok", () => {
    expect(coverStanding({ needed: 0, arranged: 0, missed: 0 }).tone).toBe("none");
    expect(coverStanding({ needed: 2, arranged: 2, missed: 0 }).tone).toBe("ok");
  });
});

describe("periodsNeedingCover on a holiday", () => {
  const slot = (day: string, period: number): Slot => ({ day, period, classId: "c", classLabel: "Class 7", subjectId: "s", subjectCode: "ENG", staffProfileId: T1, teacherShortName: "TA", parallel: false, shared: false });
  const slots = [slot("Tuesday", 1), slot("Tuesday", 2), slot("Wednesday", 1)];
  it("a closed day has no lessons to cover", () => {
    expect(periodsNeedingCover(slots, T1, "2026-10-20", "2026-10-21", "full")).toBe(3);
    expect(periodsNeedingCover(slots, T1, "2026-10-20", "2026-10-21", "full", new Set(["2026-10-20"]))).toBe(1);
  });
});
