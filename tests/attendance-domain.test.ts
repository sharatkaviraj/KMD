import { describe, expect, it } from "vitest";

import {
  attendancePercent,
  compareRoll,
  dayCredit,
  isRecorded,
  registerAuthority,
  saveRegisterSchema,
  tally,
  wasInSchool,
  type RollStudent,
} from "@/modules/attendance/domain/attendance";

const student = (
  studentId: string,
  fullName: string,
  rollNo: string | null = null,
): RollStudent => ({ studentId, fullName, admissionNo: null, rollNo });

describe("what a day is worth", () => {
  /**
   * A child who arrived at 9:15 was in school that day. A percentage that says
   * otherwise is wrong in the direction that gets a family a letter they do
   * not deserve.
   */
  it("counts late as a whole day", () => {
    expect(dayCredit("late")).toBe(1);
    expect(wasInSchool("late")).toBe(true);
  });

  it("counts approved leave as neither present nor absent", () => {
    expect(dayCredit("leave")).toBeNull();
    expect(wasInSchool("leave")).toBe(false);
  });

  it("counts a half day at the school's credit, half by default", () => {
    expect(dayCredit("half_day")).toBe(0.5);
    expect(dayCredit("half_day", { halfDayCredit: 0.75 })).toBe(0.75);
    expect(dayCredit("half_day", { halfDayCredit: 0 })).toBe(0);
    expect(wasInSchool("half_day")).toBe(true);
  });
});

describe("attendancePercent()", () => {
  it("leaves approved leave out of both halves", () => {
    // Twenty days, two of them on leave: the child attended 18 of 18.
    const statuses = [
      ...Array(18).fill("present" as const),
      ...Array(2).fill("leave" as const),
    ];

    expect(attendancePercent(statuses)).toEqual({
      percent: 100,
      counted: 18,
      present: 18,
    });
  });

  it("counts late towards attendance", () => {
    expect(attendancePercent(["present", "late", "absent", "late"]).percent).toBe(75);
  });

  it("counts a half day as the school says, the same everywhere it is asked", () => {
    const statuses = ["present", "half_day", "absent", "present"] as const;
    // 2.5 of 4 at the default half; 2.75 of 4 at three quarters.
    expect(attendancePercent([...statuses])).toEqual({ percent: 62.5, counted: 4, present: 2.5 });
    expect(attendancePercent([...statuses], { halfDayCredit: 0.75 }).percent).toBe(68.8);
    expect(attendancePercent([...statuses], { halfDayCredit: 0 }).percent).toBe(50);
  });

  it("returns null rather than zero when there is nothing to divide by", () => {
    // "No data" and "never came" must not look the same on a report card.
    expect(attendancePercent([]).percent).toBeNull();
    expect(attendancePercent(["leave", "leave"]).percent).toBeNull();
  });

  it("rounds to one decimal place", () => {
    expect(attendancePercent(["present", "present", "absent"]).percent).toBe(66.7);
  });
});

describe("compareRoll()", () => {
  it("sorts by roll number when there is one", () => {
    const roll = [student("c", "Chetan", "10"), student("a", "Asha", "2")];
    expect([...roll].sort(compareRoll).map((s) => s.studentId)).toEqual(["a", "c"]);
  });

  it("sorts a missing roll number last, not first", () => {
    // A null at the top of a register looks like the list is broken.
    const roll = [student("a", "Asha", null), student("b", "Bhavna", "5")];
    expect([...roll].sort(compareRoll).map((s) => s.studentId)).toEqual(["b", "a"]);
  });

  it("falls back to the name when neither has a number", () => {
    const roll = [student("z", "Zoya"), student("a", "Asha")];
    expect([...roll].sort(compareRoll).map((s) => s.studentId)).toEqual(["a", "z"]);
  });

  it("reads a roll number that carries a letter", () => {
    const roll = [student("b", "B", "A-12"), student("a", "A", "A-3")];
    expect([...roll].sort(compareRoll).map((s) => s.studentId)).toEqual(["a", "b"]);
  });
});

describe("tally()", () => {
  const roll = [student("a", "Asha"), student("b", "Bhavna"), student("c", "Chetan")];

  it("counts only the children on the roll", () => {
    const marks = new Map([
      ["a", "present" as const],
      ["b", "absent" as const],
      // Somebody who has left the class: their stale mark must not inflate the
      // count of a register that is not complete.
      ["gone", "present" as const],
    ]);

    const counted = tally(roll, marks);
    expect(counted.marked).toBe(2);
    expect(counted.total).toBe(3);
    expect(counted.complete).toBe(false);
  });

  it("is complete only when everybody has a mark, half days included", () => {
    const marks = new Map([
      ["a", "present" as const],
      ["b", "half_day" as const],
      ["c", "leave" as const],
    ]);

    const counted = tally(roll, marks);
    expect(counted.complete).toBe(true);
    expect(counted.half_day).toBe(1);
  });

  it("is not complete for an empty class", () => {
    // Otherwise a class with nobody in it reports a finished register.
    expect(tally([], new Map()).complete).toBe(false);
  });
});

describe("registerAuthority()", () => {
  const none = {
    isOwner: false,
    hasMarkPermission: false,
    hasMarkOnBehalfPermission: false,
    hasCorrectPermission: false,
  };

  it("lets the class teacher take and correct her own register", () => {
    expect(registerAuthority({ ...none, isOwner: true, hasMarkPermission: true })).toEqual({
      save: true,
      correct: true,
      onBehalf: false,
    });
  });

  it("does not let a subject teacher take a class's register, and says what to do instead", () => {
    const verdict = registerAuthority({ ...none, hasMarkPermission: true });
    expect(verdict.save).toBe(false);
    expect(verdict.correct).toBe(false);
    expect(verdict.reason?.en).toMatch(/class teacher/);
  });

  it("lets the office record on the teacher's behalf, and records that it did", () => {
    expect(
      registerAuthority({ ...none, hasMarkOnBehalfPermission: true, hasCorrectPermission: true }),
    ).toEqual({ save: true, correct: true, onBehalf: true });
  });

  it("does not mark a teacher's own class as on-behalf", () => {
    expect(
      registerAuthority({
        isOwner: true,
        hasMarkPermission: true,
        hasMarkOnBehalfPermission: true,
        hasCorrectPermission: true,
      }).onBehalf,
    ).toBe(false);
  });

  it("refuses somebody with no part in it", () => {
    expect(registerAuthority(none).reason?.en).toMatch(/permission/);
  });
});

describe("isRecorded()", () => {
  it("is recorded only once saved — an opened register is not", () => {
    expect(isRecorded(null)).toBe(false);
    expect(isRecorded({ revision: 0 })).toBe(false);
    expect(isRecorded({ revision: 1 })).toBe(true);
  });
});

describe("saveRegisterSchema", () => {
  const valid = {
    commandId: "6f1d2c58-5b2e-4bf5-9b1c-3a0c5c0a7e11",
    classId: "0d0e8a64-2f5b-4d0b-8a35-0a5b1e2c3d44",
    day: "2026-09-17",
    kind: "save" as const,
    expectedRevision: 0,
    marks: [{ studentId: "1c9a7f0e-4b7d-4a52-9d3e-6c1b8f2a0d55", status: "half_day" as const }],
  };

  it("accepts a whole register in one payload", () => {
    expect(saveRegisterSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a register with nobody in it", () => {
    expect(saveRegisterSchema.safeParse({ ...valid, marks: [] }).success).toBe(false);
  });

  it("refuses a day that is not a date", () => {
    expect(saveRegisterSchema.safeParse({ ...valid, day: "17/09/2026" }).success).toBe(false);
  });

  it("refuses a status it has never heard of", () => {
    expect(
      saveRegisterSchema.safeParse({
        ...valid,
        marks: [{ studentId: valid.marks[0].studentId, status: "excused" }],
      }).success,
    ).toBe(false);
  });

  it("refuses a correction that does not say why", () => {
    expect(saveRegisterSchema.safeParse({ ...valid, kind: "correction", expectedRevision: 1 }).success).toBe(false);
    expect(
      saveRegisterSchema.safeParse({ ...valid, kind: "correction", expectedRevision: 1, reason: "  " }).success,
    ).toBe(false);
    expect(
      saveRegisterSchema.safeParse({ ...valid, kind: "correction", expectedRevision: 1, reason: "Came at noon" })
        .success,
    ).toBe(true);
  });

  it("refuses a submission without its id, so no retry can be told from a new save", () => {
    const { commandId: _omitted, ...rest } = valid;
    void _omitted;
    expect(saveRegisterSchema.safeParse(rest).success).toBe(false);
  });
});
