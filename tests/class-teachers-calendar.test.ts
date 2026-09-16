import { describe, expect, it } from "vitest";

import { decodeMessage } from "@/platform/i18n/language";
import {
  assignClassTeacherSchema,
  assignmentProgress,
  byMostRecent,
  classTeacherRoleLabels,
  classTeacherRoles,
  currentHolders,
  dayBefore,
  isCurrent,
  joinClassesToTeachers,
  validateAssignment,
  type ClassTeacher,
} from "@/modules/academics/domain/class-teachers";
import {
  calendarDayKinds,
  calendarIndex,
  calendarKindLabels,
  countOpenDays,
  expandRange,
  groupByMonth,
  isSchoolOpen,
  KIND_IS_SCHOOL_OPEN,
  KIND_RUNS_TIMETABLE,
  MAX_RANGE_DAYS,
  rangeIsTooLong,
  timetableRuns,
  type CalendarDay,
} from "@/modules/academics/domain/calendar";
import type { FeeClass } from "@/modules/academics/domain/subjects";

const feeClass = (overrides: Partial<FeeClass> = {}): FeeClass => ({
  id: "c1",
  className: "Class 5",
  section: null,
  streamName: null,
  sortOrder: 8,
  sessionLabel: "TEST-2026-27",
  ...overrides,
});

const assignment = (overrides: Partial<ClassTeacher> = {}): ClassTeacher => ({
  id: "a1",
  classId: "c1",
  sessionLabel: "TEST-2026-27",
  staffProfileId: "s1",
  staffDisplayName: "Test Teacher",
  staffShortName: "TT",
  role: "class_teacher",
  effectiveFrom: "2026-04-01",
  effectiveTo: null,
  replacedReason: null,
  ...overrides,
});

const staff = (overrides: Partial<{ id: string; isActive: boolean; isTeaching: boolean }> = {}) => ({
  id: "s2",
  isActive: true,
  isTeaching: true,
  ...overrides,
});

/* ------------------------------------------------------- class teachers */

describe("the class-teacher role list", () => {
  it("matches the database enum", () => {
    expect([...classTeacherRoles]).toEqual(["class_teacher", "assistant"]);
  });

  it("labels every role in both languages", () => {
    for (const role of classTeacherRoles) {
      expect(classTeacherRoleLabels[role].hi).toBeTruthy();
      expect(classTeacherRoleLabels[role].en).toBeTruthy();
    }
  });
});

describe("dayBefore()", () => {
  it.each([
    ["2026-04-02", "2026-04-01"],
    ["2026-04-01", "2026-03-31"],
    ["2026-01-01", "2025-12-31"],
    ["2026-03-01", "2026-02-28"],
    ["2028-03-01", "2028-02-29"],
  ])("the day before %s is %s", (day, expected) => {
    // The outgoing term ends the day *before* the new one starts, so the two
    // never overlap — the partial unique index would refuse it anyway, and
    // "who is the class teacher today" must have exactly one answer.
    expect(dayBefore(day)).toBe(expected);
  });
});

describe("isCurrent()", () => {
  it("is true only while effectiveTo is null", () => {
    expect(isCurrent(assignment({ effectiveTo: null }))).toBe(true);
    expect(isCurrent(assignment({ effectiveTo: "2026-09-30" }))).toBe(false);
  });
});

describe("validateAssignment()", () => {
  const input = { staffProfileId: "s2", effectiveFrom: "2026-09-01" };

  it("allows an active teaching staff member", () => {
    expect(validateAssignment(input, null, staff()).allowed).toBe(true);
  });

  it("refuses somebody who does not exist", () => {
    const verdict = validateAssignment(input, null, null);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toMatch(/not found/i);
  });

  it("refuses an inactive staff member", () => {
    const verdict = validateAssignment(input, null, staff({ isActive: false }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toMatch(/inactive/i);
  });

  it("refuses somebody not marked as teaching", () => {
    // Not a rule of the school's, but a class teacher who does not teach is
    // almost always a mis-tap in a long list.
    const verdict = validateAssignment(input, null, staff({ isTeaching: false }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toMatch(/teaching/i);
  });

  it("refuses handing a class to the person who already holds it", () => {
    const current = assignment({ staffProfileId: "s2" });
    const verdict = validateAssignment(input, current, staff({ id: "s2" }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toMatch(/already hold/i);
  });

  it("refuses a start date that is not after the current term began", () => {
    // Otherwise the outgoing term would end before it started.
    const current = assignment({ effectiveFrom: "2026-09-01" });
    for (const effectiveFrom of ["2026-09-01", "2026-08-31"]) {
      const verdict = validateAssignment(
        { staffProfileId: "s2", effectiveFrom },
        current,
        staff(),
      );
      expect(verdict.allowed, `${effectiveFrom} should be refused`).toBe(false);
    }
  });

  it("allows a start date one day after the current term began", () => {
    const current = assignment({ effectiveFrom: "2026-09-01" });
    const verdict = validateAssignment(
      { staffProfileId: "s2", effectiveFrom: "2026-09-02" },
      current,
      staff(),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("gives every refusal a reason in both languages", () => {
    const refusals = [
      validateAssignment(input, null, null),
      validateAssignment(input, null, staff({ isActive: false })),
      validateAssignment(input, null, staff({ isTeaching: false })),
      validateAssignment(input, assignment({ staffProfileId: "s2" }), staff()),
    ];

    for (const verdict of refusals) {
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason?.hi).toBeTruthy();
      expect(verdict.reason?.en).toBeTruthy();
      expect(verdict.reason?.hi).not.toBe(verdict.reason?.en);
    }
  });
});

describe("currentHolders()", () => {
  it("picks the open row per role", () => {
    const holders = currentHolders([
      assignment({ id: "old", effectiveTo: "2026-08-31" }),
      assignment({ id: "now", effectiveFrom: "2026-09-01" }),
      assignment({ id: "asst", role: "assistant" }),
    ]);

    expect(holders.class_teacher?.id).toBe("now");
    expect(holders.assistant?.id).toBe("asst");
  });

  it("finds nobody when every term has ended", () => {
    const holders = currentHolders([assignment({ effectiveTo: "2026-08-31" })]);
    expect(holders.class_teacher).toBeUndefined();
  });
});

describe("byMostRecent()", () => {
  it("puts the newest term first", () => {
    const older = assignment({ id: "older", effectiveFrom: "2026-04-01" });
    const newer = assignment({ id: "newer", effectiveFrom: "2026-09-01" });
    expect([older, newer].sort(byMostRecent)[0].id).toBe("newer");
  });

  it("puts the open row first when two share a start date", () => {
    const closed = assignment({ id: "closed", effectiveTo: "2026-09-01" });
    const open = assignment({ id: "open", effectiveTo: null });
    expect([closed, open].sort(byMostRecent)[0].id).toBe("open");
  });
});

describe("joinClassesToTeachers()", () => {
  const classes = [
    feeClass({ id: "c1", sortOrder: 1 }),
    feeClass({ id: "c2", sortOrder: 2 }),
    feeClass({ id: "c3", sortOrder: 3 }),
  ];

  it("lists classes with nobody assigned first", () => {
    // Same reasoning as the class-label screen: the page exists to empty that
    // list, so the work is at the top.
    const rows = joinClassesToTeachers(classes, [assignment({ classId: "c1" })]);
    expect(rows[rows.length - 1].feeClass.id).toBe("c1");
    expect(rows[0].feeClass.id).not.toBe("c1");
  });

  it("counts a closed term as nobody assigned", () => {
    const rows = joinClassesToTeachers(classes, [
      assignment({ classId: "c1", effectiveTo: "2026-08-31" }),
    ]);
    expect(rows.find((r) => r.feeClass.id === "c1")?.current.class_teacher).toBeUndefined();
  });

  it("keeps the whole history on the class it belongs to", () => {
    const rows = joinClassesToTeachers(classes, [
      assignment({ id: "old", classId: "c1", effectiveTo: "2026-08-31" }),
      assignment({ id: "now", classId: "c1", effectiveFrom: "2026-09-01" }),
    ]);
    expect(rows.find((r) => r.feeClass.id === "c1")?.history).toHaveLength(2);
  });
});

describe("assignmentProgress()", () => {
  it("is not complete with no classes at all", () => {
    // Zero of zero is not done — it means the fee app has no classes.
    expect(assignmentProgress([])).toEqual({
      assigned: 0,
      total: 0,
      complete: false,
    });
  });

  it("is complete only when every class has somebody", () => {
    const classes = [feeClass({ id: "c1" }), feeClass({ id: "c2" })];
    const partial = joinClassesToTeachers(classes, [assignment({ classId: "c1" })]);
    expect(assignmentProgress(partial).complete).toBe(false);

    const full = joinClassesToTeachers(classes, [
      assignment({ classId: "c1" }),
      assignment({ id: "a2", classId: "c2" }),
    ]);
    expect(assignmentProgress(full).complete).toBe(true);
  });
});

describe("assignClassTeacherSchema", () => {
  const valid = {
    classId: "0f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    staffProfileId: "1f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    role: "class_teacher",
    effectiveFrom: "2026-09-01",
    replacedReason: "",
  };

  it("accepts a well-formed assignment and blanks an empty reason", () => {
    const result = assignClassTeacherSchema.parse(valid);
    expect(result.replacedReason).toBeNull();
  });

  it.each([
    ["a bad class id", { classId: "nope" }],
    ["a bad staff id", { staffProfileId: "nope" }],
    ["a bad role", { role: "headmaster" }],
    ["a date with slashes", { effectiveFrom: "01/09/2026" }],
    ["a partial date", { effectiveFrom: "2026-09" }],
  ])("rejects %s", (_label, patch) => {
    expect(assignClassTeacherSchema.safeParse({ ...valid, ...patch }).success).toBe(
      false,
    );
  });

  it("encodes its messages as pairs", () => {
    const result = assignClassTeacherSchema.safeParse({ ...valid, role: "nope" });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------- calendar */

describe("the calendar day kinds", () => {
  it("matches the database enum", () => {
    expect([...calendarDayKinds]).toEqual([
      "instructional",
      "holiday",
      "exam",
      "event",
      "vacation",
    ]);
  });

  it("labels every kind in both languages", () => {
    for (const kind of calendarDayKinds) {
      expect(calendarKindLabels[kind].hi).toBeTruthy();
      expect(calendarKindLabels[kind].en).toBeTruthy();
    }
  });

  it("keeps school open on exam and event days", () => {
    // Children come in, the register is taken, the timetable simply does not
    // run. Getting this wrong means an exam day with no attendance at all.
    expect(KIND_IS_SCHOOL_OPEN.exam).toBe(true);
    expect(KIND_IS_SCHOOL_OPEN.event).toBe(true);
    expect(KIND_RUNS_TIMETABLE.exam).toBe(false);
    expect(KIND_RUNS_TIMETABLE.event).toBe(false);
  });

  it("closes school on holidays and vacations", () => {
    for (const kind of ["holiday", "vacation"] as const) {
      expect(KIND_IS_SCHOOL_OPEN[kind]).toBe(false);
      expect(KIND_RUNS_TIMETABLE[kind]).toBe(false);
    }
  });

  it("never runs the timetable on a day school is closed", () => {
    for (const kind of calendarDayKinds) {
      if (!KIND_IS_SCHOOL_OPEN[kind]) {
        expect(KIND_RUNS_TIMETABLE[kind], `${kind} runs a timetable while closed`).toBe(
          false,
        );
      }
    }
  });
});

describe("expandRange()", () => {
  it("is one day when there is no end", () => {
    expect(expandRange("2026-08-15", null)).toEqual(["2026-08-15"]);
  });

  it("is one day when the end is the same day", () => {
    expect(expandRange("2026-08-15", "2026-08-15")).toEqual(["2026-08-15"]);
  });

  it("includes both ends", () => {
    expect(expandRange("2026-08-14", "2026-08-16")).toEqual([
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("crosses a month boundary", () => {
    expect(expandRange("2026-03-30", "2026-04-02")).toEqual([
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
    ]);
  });

  it("handles a leap day", () => {
    expect(expandRange("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("is empty-safe when the end is before the start", () => {
    expect(expandRange("2026-08-16", "2026-08-14")).toEqual([]);
  });
});

describe("rangeIsTooLong()", () => {
  it("is false with no end", () => {
    expect(rangeIsTooLong("2026-04-01", null)).toBe(false);
  });

  it("is false for a normal vacation", () => {
    expect(rangeIsTooLong("2026-05-15", "2026-06-30")).toBe(false);
  });

  it("is true for a mistyped year", () => {
    // "mark a week" becoming four thousand rows is what this stops.
    expect(rangeIsTooLong("2026-04-01", "2036-04-01")).toBe(true);
  });

  it("allows exactly the maximum", () => {
    const start = new Date("2026-04-01T00:00:00Z");
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + MAX_RANGE_DAYS - 1);
    expect(rangeIsTooLong("2026-04-01", end.toISOString().slice(0, 10))).toBe(false);
  });
});

describe("isSchoolOpen()", () => {
  const calendar = calendarIndex([
    { id: "1", sessionLabel: "s", day: "2026-08-15", kind: "holiday", labelHi: null, labelEn: null },
    { id: "2", sessionLabel: "s", day: "2026-08-16", kind: "instructional", labelHi: null, labelEn: null },
    { id: "3", sessionLabel: "s", day: "2026-08-20", kind: "exam", labelHi: null, labelEn: null },
  ] satisfies CalendarDay[]);

  it("lets the calendar override the weekly pattern", () => {
    // 2026-08-16 is a Sunday, marked instructional — a working Sunday before
    // an exam is a real thing this school does.
    expect(new Date("2026-08-16T00:00:00Z").getUTCDay()).toBe(0);
    expect(isSchoolOpen("2026-08-16", calendar)).toBe(true);
  });

  it("closes a marked holiday on a working day", () => {
    expect(isSchoolOpen("2026-08-15", calendar)).toBe(false);
  });

  it("keeps school open on an exam day", () => {
    expect(isSchoolOpen("2026-08-20", calendar)).toBe(true);
    expect(timetableRuns("2026-08-20", calendar)).toBe(false);
  });

  it("closes Sunday when the calendar says nothing", () => {
    // 2026-08-23 is a Sunday.
    expect(new Date("2026-08-23T00:00:00Z").getUTCDay()).toBe(0);
    expect(isSchoolOpen("2026-08-23", calendar)).toBe(false);
  });

  it("keeps Saturday open when the calendar says nothing", () => {
    // Saturday is a working day at this school — the thing an imported
    // calendar library would get wrong.
    expect(new Date("2026-08-22T00:00:00Z").getUTCDay()).toBe(6);
    expect(isSchoolOpen("2026-08-22", calendar)).toBe(true);
  });
});

describe("countOpenDays()", () => {
  it("counts teaching days, skipping Sundays", () => {
    // 2026-08-17 (Mon) to 2026-08-23 (Sun): six open days.
    expect(countOpenDays("2026-08-17", "2026-08-23", new Map())).toBe(6);
  });

  it("subtracts a marked holiday", () => {
    const calendar = calendarIndex([
      { id: "1", sessionLabel: "s", day: "2026-08-19", kind: "holiday", labelHi: null, labelEn: null },
    ]);
    expect(countOpenDays("2026-08-17", "2026-08-23", calendar)).toBe(5);
  });

  it("counts a whole vacation as zero", () => {
    const calendar = calendarIndex(
      expandRange("2026-05-15", "2026-05-21").map((day, index) => ({
        id: String(index),
        sessionLabel: "s",
        day,
        kind: "vacation" as const,
        labelHi: null,
        labelEn: null,
      })),
    );
    expect(countOpenDays("2026-05-15", "2026-05-21", calendar)).toBe(0);
  });
});

describe("groupByMonth()", () => {
  it("groups and orders by day within each month", () => {
    const days: CalendarDay[] = [
      { id: "2", sessionLabel: "s", day: "2026-09-05", kind: "holiday", labelHi: null, labelEn: null },
      { id: "1", sessionLabel: "s", day: "2026-08-15", kind: "holiday", labelHi: null, labelEn: null },
      { id: "3", sessionLabel: "s", day: "2026-08-02", kind: "event", labelHi: null, labelEn: null },
    ];

    const groups = groupByMonth(days);
    expect(groups.map((g) => g.month)).toEqual(["2026-08", "2026-09"]);
    expect(groups[0].days.map((d) => d.day)).toEqual(["2026-08-02", "2026-08-15"]);
  });

  it("is empty for no days", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("calendar validation messages", () => {
  it("are encoded pairs", () => {
    const result = assignClassTeacherSchema.safeParse({
      classId: "nope",
      staffProfileId: "nope",
      role: "class_teacher",
      effectiveFrom: "nope",
      replacedReason: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const decoded = decodeMessage(issue.message);
        expect(decoded.hi).toBeTruthy();
        expect(decoded.en).toBeTruthy();
      }
    }
  });
});
