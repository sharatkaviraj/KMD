import { describe, expect, it } from "vitest";

import type { RollStudent } from "@/modules/attendance/domain/attendance";
import {
  belowThreshold,
  buildMonthlySheet,
  sheetDays,
  sheetTotals,
} from "@/modules/attendance/domain/register-sheet";

const student = (
  studentId: string,
  fullName: string,
  rollNo: string | null,
): RollStudent => ({ studentId, fullName, admissionNo: null, rollNo });

const roll = [
  student("a", "Asha", "1"),
  student("b", "Bhavna", "2"),
  student("c", "Chetan", "3"),
];

describe("sheetDays()", () => {
  /**
   * Both halves of the union matter, for opposite reasons: an open day with no
   * register is the gap a head of school needs to see, and a register taken on
   * a day the calendar calls closed is still a fact about the children.
   */
  it("keeps an open day nobody took a register for", () => {
    expect(sheetDays(["2026-09-01", "2026-09-02"], ["2026-09-01"])).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("keeps a register taken on a day the calendar calls closed", () => {
    expect(sheetDays(["2026-09-01"], ["2026-09-06"])).toEqual([
      "2026-09-01",
      "2026-09-06",
    ]);
  });

  it("does not repeat a day that is in both", () => {
    expect(sheetDays(["2026-09-01"], ["2026-09-01"])).toEqual(["2026-09-01"]);
  });

  it("puts the columns in date order whatever order they arrived in", () => {
    expect(sheetDays(["2026-09-10", "2026-09-02"], ["2026-09-05"])).toEqual([
      "2026-09-02",
      "2026-09-05",
      "2026-09-10",
    ]);
  });
});

describe("buildMonthlySheet()", () => {
  const sheet = buildMonthlySheet({
    month: "2026-09",
    roll,
    openDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    marks: [
      { studentId: "a", day: "2026-09-01", status: "present" },
      { studentId: "a", day: "2026-09-02", status: "absent" },
      { studentId: "a", day: "2026-09-03", status: "late" },
      { studentId: "b", day: "2026-09-01", status: "leave" },
      { studentId: "b", day: "2026-09-02", status: "present" },
    ],
  });

  it("gives every child on the roll a row, marked or not", () => {
    // Chetan has no marks at all. Dropping him would make the register look
    // like a class of two.
    expect(sheet.rows.map((row) => row.student.studentId)).toEqual(["a", "b", "c"]);
  });

  it("puts one cell per column, in the same order as the days", () => {
    const asha = sheet.rows[0];
    expect(asha.cells).toEqual(["present", "absent", "late"]);
    expect(asha.cells).toHaveLength(sheet.days.length);
  });

  it("leaves a day with no mark blank rather than absent", () => {
    // Inventing absences out of a teacher's forgotten register is the one
    // thing a monthly sheet must never do.
    const bhavna = sheet.rows[1];
    expect(bhavna.cells[2]).toBeNull();
    expect(bhavna.absent).toBe(0);
  });

  it("counts late as attendance and leaves leave out of the sum", () => {
    // Asha: present, absent, late → attended 2 of 3.
    expect(sheet.rows[0].percent).toBe(66.7);
    // Bhavna: leave, present → the leave day is not counted at all.
    expect(sheet.rows[1].percent).toBe(100);
  });

  it("says nothing rather than zero for a child with no marks", () => {
    expect(sheet.rows[2].percent).toBeNull();
  });

  it("counts the days somebody actually recorded", () => {
    expect(sheet.daysRecorded).toBe(3);
  });

  it("sorts the rows the way the register is read", () => {
    const shuffled = buildMonthlySheet({
      month: "2026-09",
      roll: [student("z", "Zoya", "9"), student("a", "Asha", "1")],
      openDays: [],
      marks: [],
    });

    expect(shuffled.rows.map((row) => row.student.studentId)).toEqual(["a", "z"]);
  });
});

describe("sheetTotals()", () => {
  it("adds the class up across every row", () => {
    const sheet = buildMonthlySheet({
      month: "2026-09",
      roll,
      openDays: ["2026-09-01"],
      marks: [
        { studentId: "a", day: "2026-09-01", status: "present" },
        { studentId: "b", day: "2026-09-01", status: "absent" },
        { studentId: "c", day: "2026-09-01", status: "late" },
      ],
    });

    const totals = sheetTotals(sheet);
    expect(totals).toMatchObject({ present: 1, absent: 1, late: 1, leave: 0 });
    // Two of three were in school; late counts.
    expect(totals.percent).toBe(66.7);
  });

  it("is null, not zero, for a month nobody recorded", () => {
    const empty = buildMonthlySheet({
      month: "2026-09",
      roll,
      openDays: ["2026-09-01"],
      marks: [],
    });

    expect(sheetTotals(empty).percent).toBeNull();
  });
});

describe("belowThreshold()", () => {
  const sheet = buildMonthlySheet({
    month: "2026-09",
    roll,
    openDays: ["2026-09-01", "2026-09-02"],
    marks: [
      { studentId: "a", day: "2026-09-01", status: "absent" },
      { studentId: "a", day: "2026-09-02", status: "absent" },
      { studentId: "b", day: "2026-09-01", status: "present" },
      { studentId: "b", day: "2026-09-02", status: "present" },
    ],
  });

  it("finds the children a class teacher has to act on", () => {
    expect(belowThreshold(sheet, 75).map((row) => row.student.studentId)).toEqual([
      "a",
    ]);
  });

  it("does not count a child with no data as failing", () => {
    // Chetan has no marks. "No data" is not "below 75%".
    expect(belowThreshold(sheet, 75).map((row) => row.student.studentId)).not.toContain(
      "c",
    );
  });
});
