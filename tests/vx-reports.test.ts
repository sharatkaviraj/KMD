import { describe, expect, it } from "vitest";

import {
  bucketCollection,
  buildClasswise,
  buildDefaulters,
  cellStudents,
  collectionRange,
  sectionDefaulters,
  sessionStart,
  sumBuckets,
  teacherListText,
  type InstallmentBalance,
} from "@/modules/reports/vx/domain/reports";

const row = (o: Partial<InstallmentBalance>): InstallmentBalance => ({
  studentId: "s1",
  studentName: "Test Child",
  admissionNo: null,
  fatherName: "Test Father",
  fatherPhone: null,
  classId: "c7",
  classLabel: "Class 7",
  installmentNo: 1,
  dueDate: "2026-07-20",
  pendingAmount: 0,
  lateFeePending: 0,
  studentStatus: "active",
  ...o,
});

const TODAY = "2026-10-08";

describe("defaulters", () => {
  const rows = [
    row({ studentId: "s1", installmentNo: 1, pendingAmount: 1000, lateFeePending: 100 }),
    row({ studentId: "s1", installmentNo: 3, dueDate: "2026-10-20", pendingAmount: 5000 }),
    row({ studentId: "s2", installmentNo: 1, pendingAmount: 0, lateFeePending: 100 }),
    row({ studentId: "s3", installmentNo: 2, dueDate: "2026-09-20", pendingAmount: 700, studentStatus: "left" }),
  ];

  it("counts only what is due, keeps late fee apart, and drops late-fee-only families", () => {
    const d = buildDefaulters(rows, TODAY);
    expect(d.map((r) => r.studentId)).toEqual(["s1"]);
    expect(d[0].pending).toBe(1000);
    expect(d[0].lateFee).toBe(100);
  });

  it("includes students who left only when asked", () => {
    expect(buildDefaulters(rows, TODAY, { includeLeft: true }).map((r) => r.studentId).sort()).toEqual(["s1", "s3"]);
  });

  it("groups by class with their own totals and a teacher's text that keeps late fee separate", () => {
    const sections = sectionDefaulters(buildDefaulters(rows, TODAY, { includeLeft: true }), ["Class 7"]);
    expect(sections).toHaveLength(1);
    expect(sections[0].pending).toBe(1700);
    const text = teacherListText(sections[0], TODAY, "Test School");
    expect(text).toContain("Total ₹1,700");
    expect(text).toContain("late fee separate ₹100");
  });
});

describe("pending by class", () => {
  it("never adds not-due-yet to pending today", () => {
    const rows = [
      row({ studentId: "a", installmentNo: 1, pendingAmount: 1000 }),
      row({ studentId: "b", installmentNo: 1, pendingAmount: 500 }),
      row({ studentId: "a", installmentNo: 3, dueDate: "2026-10-20", pendingAmount: 4000 }),
    ];
    const cw = buildClasswise(rows, TODAY);
    expect(cw.rows[0].pendingToday).toBe(1500);
    expect(cw.rows[0].notDueYet).toBe(4000);
    expect(cw.rows[0].cells[1].due).toEqual({ amount: 1500, students: 2 });
    expect(cw.rows[0].cells[3].notDue).toEqual({ amount: 4000, students: 1 });
    expect(cellStudents(rows, TODAY, "Class 7", 1).map((s) => s.studentId)).toEqual(["a", "b"]);
  });
});

describe("collection", () => {
  const receipts = [
    { paymentDate: "2026-10-01", paymentMode: "upi", amount: 1000, classId: "c7", reversed: false },
    { paymentDate: "2026-10-01", paymentMode: "cash", amount: 500, classId: "c8", reversed: false },
    { paymentDate: "2026-10-02", paymentMode: "cash", amount: 900, classId: "c7", reversed: true },
    { paymentDate: "2026-10-03", paymentMode: "discount", amount: 300, classId: "c7", reversed: false },
  ];

  it("leaves out reversed receipts and discounts, with a bucket for every day", () => {
    const b = bucketCollection(receipts, "2026-10-01", "2026-10-03");
    expect(b.map((x) => x.total)).toEqual([1500, 0, 0]);
    expect(sumBuckets(b).byMode).toMatchObject({ upi: 1000, cash: 500 });
    expect(sumBuckets(bucketCollection(receipts, "2026-10-01", "2026-10-03", { classId: "c7" })).total).toBe(1000);
  });

  it("switches to months for a long range", () => {
    expect(bucketCollection(receipts, "2026-04-01", "2026-10-08").map((b) => b.key)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("works out date ranges without sorting session labels", () => {
    expect(sessionStart("2026-27", TODAY)).toBe("2026-04-01");
    expect(sessionStart("TEST-2026-27", TODAY)).toBe("2026-04-01");
    expect(collectionRange("last", TODAY, "2026-27", {})).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(collectionRange("custom", TODAY, "2026-27", { from: "2026-10-05", to: "2026-10-01" })).toEqual({ from: "2026-10-01", to: "2026-10-05" });
  });
});
