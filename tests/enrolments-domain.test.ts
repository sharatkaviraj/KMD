import { describe, expect, it } from "vitest";

import {
  differenceIsFixedByRebuild,
  differenceLabels,
  enrolmentStatusLabels,
  enrolmentStatuses,
  fixableCount,
  groupDifferences,
  isActiveFeeStudent,
  planRebuild,
  planStudentSync,
  reconcile,
  rollByClass,
  type Enrolment,
  type FeeStudent,
} from "@/modules/enrolments/domain/enrolments";
import type { FeeClass } from "@/modules/academics/domain/subjects";

const student = (overrides: Partial<FeeStudent> = {}): FeeStudent => ({
  id: "st1",
  admissionNo: "A-001",
  fullName: "Test Child",
  classId: "c1",
  rollNo: "1",
  status: "active",
  ...overrides,
});

const enrolment = (overrides: Partial<Enrolment> = {}): Enrolment => ({
  id: "e1",
  studentId: "st1",
  classId: "c1",
  sessionLabel: "TEST-2026-27",
  rollNo: "1",
  status: "enrolled",
  ...overrides,
});

const feeClass = (overrides: Partial<FeeClass> = {}): FeeClass => ({
  id: "c1",
  className: "Class 1",
  section: null,
  streamName: null,
  sortOrder: 1,
  sessionLabel: "TEST-2026-27",
  ...overrides,
});

describe("the status list", () => {
  it("matches the database enum", () => {
    expect([...enrolmentStatuses]).toEqual(["enrolled", "left", "promoted"]);
  });

  it("labels every status in both languages", () => {
    for (const status of enrolmentStatuses) {
      expect(enrolmentStatusLabels[status].hi).toBeTruthy();
      expect(enrolmentStatusLabels[status].en).toBeTruthy();
    }
  });
});

describe("isActiveFeeStudent()", () => {
  it.each([["active"], ["ACTIVE"], [null], [""], ["something-new"]])(
    "treats %s as active",
    (status) => {
      // Deliberately permissive: the fee app's status is its own vocabulary,
      // and silently dropping a child because of an unrecognised value is
      // worse than showing them in the consistency check.
      expect(isActiveFeeStudent(student({ status }))).toBe(true);
    },
  );

  it.each([["left"], ["Left"], ["inactive"], ["graduated"]])(
    "treats %s as gone",
    (status) => {
      expect(isActiveFeeStudent(student({ status }))).toBe(false);
    },
  );
});

describe("reconcile()", () => {
  it("finds nothing when both sides agree", () => {
    const check = reconcile([student()], [enrolment()]);
    expect(check.differences).toEqual([]);
    expect(check.inAgreement).toBe(1);
  });

  it("reports a student with no enrolment row", () => {
    const check = reconcile([student()], []);
    expect(check.differences).toHaveLength(1);
    expect(check.differences[0].kind).toBe("missing");
  });

  it("does not report a student who left before the record existed", () => {
    // Not a gap — they were never enrolled here and never will be.
    const check = reconcile([student({ status: "left" })], []);
    expect(check.differences).toEqual([]);
  });

  it("does not report a student with no class at all", () => {
    // They cannot be enrolled anywhere; planRebuild counts them separately.
    const check = reconcile([student({ classId: null })], []);
    expect(check.differences).toEqual([]);
  });

  it("reports a class change", () => {
    const check = reconcile(
      [student({ classId: "c2" })],
      [enrolment({ classId: "c1" })],
    );
    expect(check.differences[0].kind).toBe("class-changed");
    expect(check.differences[0].detail).toEqual({ from: "c1", to: "c2" });
  });

  it("reports a roll-number change only when the class matches", () => {
    const check = reconcile(
      [student({ rollNo: "7" })],
      [enrolment({ rollNo: "1" })],
    );
    expect(check.differences[0].kind).toBe("roll-changed");
    expect(check.differences[0].detail).toEqual({ from: "1", to: "7" });
  });

  it("prefers the class change when both differ", () => {
    // A child who moved class almost certainly has a new roll number too;
    // reporting both would double-count one event.
    const check = reconcile(
      [student({ classId: "c2", rollNo: "7" })],
      [enrolment({ classId: "c1", rollNo: "1" })],
    );
    expect(check.differences).toHaveLength(1);
    expect(check.differences[0].kind).toBe("class-changed");
  });

  it("reports a student the fee app now says has left", () => {
    const check = reconcile([student({ status: "left" })], [enrolment()]);
    expect(check.differences[0].kind).toBe("left-in-fee-app");
  });

  it("reports an enrolment whose student the fee app no longer has", () => {
    // The other direction, and the one a rebuild cannot resolve.
    const check = reconcile([], [enrolment({ studentId: "gone" })]);
    expect(check.differences[0].kind).toBe("student-gone");
  });

  it("counts both sides", () => {
    const check = reconcile(
      [student({ id: "a" }), student({ id: "b" })],
      [enrolment({ studentId: "a" })],
    );
    expect(check.feeStudents).toBe(2);
    expect(check.enrolments).toBe(1);
  });

  it("treats a null roll number on both sides as agreement", () => {
    const check = reconcile(
      [student({ rollNo: null })],
      [enrolment({ rollNo: null })],
    );
    expect(check.differences).toEqual([]);
  });
});

describe("differences the office has to decide", () => {
  it("says a rebuild fixes everything except a vanished student", () => {
    // Their attendance and marks are recorded here, so dropping the row would
    // orphan history that is still true.
    expect(differenceIsFixedByRebuild["student-gone"]).toBe(false);
    for (const kind of [
      "missing",
      "class-changed",
      "roll-changed",
      "left-in-fee-app",
    ] as const) {
      expect(differenceIsFixedByRebuild[kind]).toBe(true);
    }
  });

  it("labels every kind in both languages", () => {
    for (const kind of Object.keys(differenceLabels) as (keyof typeof differenceLabels)[]) {
      expect(differenceLabels[kind].hi).toBeTruthy();
      expect(differenceLabels[kind].en).toBeTruthy();
      expect(differenceLabels[kind].hi).not.toBe(differenceLabels[kind].en);
    }
  });

  it("counts only what a rebuild would resolve", () => {
    const check = reconcile(
      [student({ id: "a" })],
      [enrolment({ studentId: "gone" })],
    );
    expect(check.differences).toHaveLength(2);
    expect(fixableCount(check.differences)).toBe(1);
  });
});

describe("groupDifferences()", () => {
  it("puts the unresolvable kind first", () => {
    // Worst first: a vanished student needs a person, a roll number does not.
    const check = reconcile(
      [student({ id: "a", rollNo: "9" })],
      [enrolment({ studentId: "a", rollNo: "1" }), enrolment({ id: "e2", studentId: "gone" })],
    );
    expect(groupDifferences(check.differences)[0].kind).toBe("student-gone");
  });

  it("is empty when there is nothing to report", () => {
    expect(groupDifferences([])).toEqual([]);
  });

  it("collects every item of a kind into one group", () => {
    const check = reconcile(
      [student({ id: "a" }), student({ id: "b" })],
      [],
    );
    const groups = groupDifferences(check.differences);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe("planRebuild()", () => {
  it("writes a row per active student who has a class", () => {
    const plan = planRebuild(
      [student({ id: "a" }), student({ id: "b" })],
      "TEST-2026-27",
    );
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toMatchObject({
      student_id: "a",
      class_id: "c1",
      session_label: "TEST-2026-27",
      status: "enrolled",
    });
  });

  it("skips a student the fee app says has left, and counts them", () => {
    const plan = planRebuild([student({ status: "left" })], "TEST-2026-27");
    expect(plan.rows).toHaveLength(0);
    expect(plan.skippedInactive).toBe(1);
  });

  it("skips a student with no class, and counts them separately", () => {
    // Counted and reported rather than guessed at — there is no right class
    // to invent for them.
    const plan = planRebuild([student({ classId: null })], "TEST-2026-27");
    expect(plan.rows).toHaveLength(0);
    expect(plan.skippedNoClass).toBe(1);
  });

  it("carries the roll number across", () => {
    const plan = planRebuild([student({ rollNo: "12" })], "TEST-2026-27");
    expect(plan.rows[0].roll_no).toBe("12");
  });

  it("is empty for no students", () => {
    expect(planRebuild([], "TEST-2026-27")).toEqual({
      rows: [],
      skippedNoClass: 0,
      skippedInactive: 0,
    });
  });
});

describe("rollByClass()", () => {
  const classes = [
    feeClass({ id: "c1", sortOrder: 1 }),
    feeClass({ id: "c2", sortOrder: 2 }),
  ];

  it("counts enrolled students per class", () => {
    const roll = rollByClass(classes, [
      enrolment({ id: "1", studentId: "a", classId: "c1" }),
      enrolment({ id: "2", studentId: "b", classId: "c1" }),
      enrolment({ id: "3", studentId: "c", classId: "c2" }),
    ]);
    expect(roll.map((r) => r.enrolled)).toEqual([2, 1]);
  });

  it("does not count a student who has left", () => {
    const roll = rollByClass(classes, [
      enrolment({ studentId: "a", classId: "c1", status: "left" }),
    ]);
    expect(roll[0].enrolled).toBe(0);
  });

  it("shows a class with nobody in it as zero rather than omitting it", () => {
    // An empty class is a fact worth seeing on the roll.
    const roll = rollByClass(classes, []);
    expect(roll).toHaveLength(2);
    expect(roll.every((r) => r.enrolled === 0)).toBe(true);
  });

  it("keeps the fee app's class order", () => {
    const roll = rollByClass(
      [feeClass({ id: "c2", sortOrder: 9 }), feeClass({ id: "c1", sortOrder: 1 })],
      [],
    );
    expect(roll.map((r) => r.feeClass.id)).toEqual(["c1", "c2"]);
  });
});

describe("planStudentSync", () => {
  it("enrols an active child in their class's session, marks leavers left, and leaves graduates alone", () => {
    const plan = planStudentSync([
      { ...student({ id: "a", classId: "c2" }), classSession: "2026-27" },
      { ...student({ id: "b", status: "left" }), classSession: "2026-27" },
      { ...student({ id: "c", status: "inactive" }), classSession: "2026-27" },
      { ...student({ id: "d", status: "graduated" }), classSession: "2026-27" },
      { ...student({ id: "e", classId: null }), classSession: null },
    ]);
    expect(plan.enrol).toEqual([{ student_id: "a", class_id: "c2", session_label: "2026-27", roll_no: "1", status: "enrolled", left_on: null }]);
    expect(plan.left).toEqual(["b", "c"]);
  });
});
