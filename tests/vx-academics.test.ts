import { describe, expect, it } from "vitest";

import {
  addDays,
  attendanceBand,
  attentionChips,
  attentionWeight,
  average,
  deltaLabel,
  enteredPct,
  isDay,
  isMonth,
  isUuid,
  lateTeachers,
  mondayOf,
  monthRange,
  presentPct,
  shiftMonth,
  tally,
  telHref,
  weeklySummary,
  weeklySummaryLine,
  type PaperProgress,
} from "@/vx/screens/academics/domain";

describe("attendance tally", () => {
  it("counts late as present and leaves leave out", () => {
    const t = tally(["present", "late", "absent", "leave", "half_day"]);
    expect(t.counted).toBe(4);
    expect(t.credit).toBe(2.5);
    expect(presentPct(t)).toBe(62.5);
  });

  it("has no percentage when nobody is counted", () => {
    expect(presentPct(tally(["leave"]))).toBeNull();
  });

  it("bands the heat strip at 95, 90 and 85", () => {
    expect(attendanceBand(null)).toBe("none");
    expect(attendanceBand(95)).toBe("top");
    expect(attendanceBand(94.9)).toBe("good");
    expect(attendanceBand(85)).toBe("fair");
    expect(attendanceBand(84)).toBe("low");
  });
});

describe("needs attention", () => {
  const base = { reasons: [], attendancePct: null, below33Subjects: [], dropPoints: null, dropSubject: null, openNotes: 0 };

  it("writes one chip per rule", () => {
    const chips = attentionChips({ ...base, reasons: ["attendance", "below_33", "dropped", "notes"], attendancePct: 71.6, below33Subjects: ["MATHS", "SST"], dropPoints: 18.2, openNotes: 2 });
    expect(chips.map((c) => c.text.en)).toEqual(["Attendance 72%", "Below 33% in Maths & Social Sci.", "Marks dropped 18%", "2 open notes"]);
    const three = attentionChips({ ...base, reasons: ["below_33"], below33Subjects: ["MATHS", "SST", "EVS"] });
    expect(three.map((c) => c.text.en)).toEqual(["Below 33% in Maths +2"]);
  });

  it("weighs more rules above a worse single rule", () => {
    const two = attentionWeight({ ...base, reasons: ["below_33", "notes"], below33Subjects: ["EVS"], openNotes: 2 });
    const one = attentionWeight({ ...base, reasons: ["attendance"], attendancePct: 20 });
    expect(two).toBeGreaterThan(one);
  });
});

describe("marks entry", () => {
  const paper = (over: Partial<PaperProgress>): PaperProgress => ({ paperId: "p", classId: "c", classLabel: "Class 5", subject: "MATHS", entered: 0, roll: 10, submitted: false, teacherId: "t1", ...over });

  it("counts a submitted paper as complete", () => {
    expect(enteredPct([paper({ submitted: true, entered: 3 }), paper({ entered: 5 })])).toBe(75);
    expect(enteredPct([])).toBe(0);
  });

  it("lists the teacher furthest behind first and skips papers with nobody to remind", () => {
    const late = lateTeachers([paper({ teacherId: "a", entered: 8 }), paper({ teacherId: "b", entered: 1 }), paper({ teacherId: null }), paper({ teacherId: "c", submitted: true })]);
    expect(late.map((t) => t.teacherId)).toEqual(["b", "a"]);
  });

  it("averages and labels a change", () => {
    expect(average([])).toBeNull();
    expect(average([50, 61])).toBe(56);
    expect(deltaLabel(60, 55)).toEqual({ text: "▲ 5", tone: "ok" });
    expect(deltaLabel(50, 53)).toEqual({ text: "▼ 3", tone: "bad" });
    expect(deltaLabel(null, 3).tone).toBe("mut");
  });
});

describe("weekly summary", () => {
  const facts = { coordinator: "Test Coordinator", weekLabel: "5–10 Oct", attendancePct: 91.2, attendanceBefore: 90, classesAlwaysMarked: 17, classes: 19, marksPct: 64, examLabel: { en: "Half-yearly", hi: "अर्धवार्षिक" }, lateTeachers: 3, attention: 54, attentionNew: 6, notesOpen: 4, correctionsMade: 2 };

  it("gives four lines in both languages", () => {
    const lines = weeklySummary(facts);
    expect(lines).toHaveLength(4);
    expect(lines[0].en).toContain("91.2% (+1.2 vs last week)");
    expect(lines.every((l) => !!l.hi)).toBe(true);
    expect(weeklySummaryLine(facts)).toContain("54 children need attention");
  });

  it("names the current exam, and says so when none is being marked", () => {
    expect(weeklySummary({ ...facts, examLabel: { en: "AI Rehearsal", hi: null } })[1].en).toBe("AI Rehearsal marks 64% entered; 3 teachers behind.");
    expect(weeklySummary({ ...facts, examLabel: null })[1].en).toBe("No exam is being marked this week.");
  });
});

describe("dates and params", () => {
  it("finds Monday and moves days and months", () => {
    expect(mondayOf("2026-10-10")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(monthRange("2027-02")).toEqual({ first: "2027-02-01", last: "2027-02-28" });
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("refuses malformed params", () => {
    expect(isMonth("2026-13")).toBe(false);
    expect(isDay("2026-10-10")).toBe(true);
    expect(isDay("10-10-2026")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(telHref("98290 12345")).toBe("tel:+919829012345");
    expect(telHref("123")).toBeNull();
  });
});
