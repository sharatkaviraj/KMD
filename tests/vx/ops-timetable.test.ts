import { describe, expect, it } from "vitest";

import {
  affectedTeachers,
  allClashes,
  applyChanges,
  changeNotice,
  clashFor,
  classGrid,
  freeAt,
  leaveProblems,
  periodsNeedingCover,
  schoolDays,
  spanPeriods,
  subjectFamily,
  teacherLoad,
  weekDates,
  weekdayOf,
  type PendingChange,
  type Slot,
} from "@/vx/screens/timetable/domain/timetable";

const slot = (o: Partial<Slot>): Slot => ({
  day: "Monday",
  period: 0,
  classId: "c5",
  classLabel: "Class 5",
  subjectId: "math",
  subjectCode: "MATH",
  staffProfileId: "t1",
  teacherShortName: "T1",
  parallel: false,
  shared: false,
  ...o,
});

const change = (o: Partial<PendingChange>): PendingChange => ({
  id: "x",
  day: "Monday",
  period: 0,
  classId: "c5",
  classLabel: "Class 5",
  fromSubjectCode: "MATH",
  fromTeacher: "T1",
  subjectId: "eng",
  subjectCode: "ENG",
  staffProfileId: "t2",
  teacherShortName: "T2",
  createdBy: null,
  createdAt: "2026-10-10T00:00:00Z",
  ...o,
});

const slots = [slot({}), slot({ period: 1, classId: "c6", classLabel: "Class 6" }), slot({ staffProfileId: "t2", teacherShortName: "T2", classId: "c6", classLabel: "Class 6", subjectCode: "ENG" })];

describe("week", () => {
  it("knows weekdays and the school week", () => {
    expect(weekdayOf("2026-10-10")).toBe("Saturday");
    expect(weekdayOf("2026-10-11")).toBeNull();
    expect(weekDates("2026-10-10")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(weekDates("2026-10-11")[0]).toBe("2026-10-12");
  });
});

describe("grid and edits", () => {
  it("lays pending edits over the live timetable", () => {
    const after = applyChanges(slots, [change({})]);
    const cell = classGrid(after, "c5").get("Monday|0");
    expect(cell?.map((s) => s.subjectCode)).toEqual(["ENG"]);
  });

  it("finds clashes and free teachers", () => {
    expect(clashFor(slots, { day: "Monday", period: 0, classId: "c5", staffProfileId: "t2" })?.classLabel).toBe("Class 6");
    expect(clashFor(slots, { day: "Monday", period: 2, classId: "c5", staffProfileId: "t2" })).toBeNull();
    expect(allClashes([...slots, slot({ classId: "c7", classLabel: "Class 7" })])).toHaveLength(1);
    expect(freeAt(slots, ["t1", "t2", "t3"], "Monday", 1)).toEqual(["t2", "t3"]);
  });

  it("counts a teacher's load", () => {
    const load = teacherLoad(slots, "t1");
    expect(load.total).toBe(2);
    expect(load.perDay[0]).toBe(2);
    expect(load.free).toBe(46);
  });

  it("names everyone an edit touches and writes their notice", () => {
    const touched = affectedTeachers([change({})], slots);
    expect([...touched.keys()].sort()).toEqual(["t1", "t2"]);
    expect(changeNotice("Test", [change({})], (c) => c).en).toBe("Hello Test, timetable changes:\nClass 5, Mon P1: ENG (T2)");
  });

  it("colours subjects by family", () => {
    expect(subjectFamily("MATH")).toBe("maths");
    expect(subjectFamily("Physics")).toBe("science");
    expect(subjectFamily("XYZ")).toBe("other");
  });
});

describe("leave", () => {
  it("splits the day and skips Sundays", () => {
    expect(spanPeriods("first_half")).toEqual([0, 1, 2, 3]);
    expect(spanPeriods("second_half")).toEqual([4, 5, 6, 7]);
    expect(schoolDays("2026-10-10", "2026-10-12")).toEqual(["2026-10-10", "2026-10-12"]);
  });

  it("counts periods needing cover", () => {
    expect(periodsNeedingCover(slots, "t1", "2026-10-12", "2026-10-12", "full")).toBe(2);
    expect(periodsNeedingCover(slots, "t1", "2026-10-12", "2026-10-12", "second_half")).toBe(0);
  });

  it("validates a request", () => {
    expect(leaveProblems({ staffId: "", from: "2026-10-12", to: "2026-10-12" })).toEqual(["who"]);
    expect(leaveProblems({ staffId: "t1", from: "2026-10-12", to: "2026-10-11" })).toEqual(["order"]);
    expect(leaveProblems({ staffId: "t1", from: "2026-10-01", to: "2026-12-01" })).toEqual(["too_long"]);
    expect(leaveProblems({ staffId: "t1", from: "2026-10-12", to: "2026-10-13" })).toEqual([]);
  });
});
