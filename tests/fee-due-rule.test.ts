import { describe, expect, it } from "vitest";

import { balanceStatusOn, dueBucketOn, isPendingOn, splitFeesByDue, usualDueDate } from "@/modules/fees/domain/due-rule";
import { deskTotals, isDueOn, isOverdueOn, listPending } from "@/modules/payments/vx/domain/desk";
import { buildClasswise, buildDefaulters, type InstallmentBalance } from "@/modules/reports/vx/domain/reports";

/*
 * Smoke school day, 20 Oct: Installment 3 fell due that day. Reports counted
 * it as pending (`<=`), the Desk and Dues did not (`<`), so "pending today"
 * read ₹52.7 L on one screen and ₹26.6 L on another; the class heat table said
 * "929 students" for ~583 children, and an outlier row put "Inst 3 · 1 Oct"
 * in the heading. One rule now, tested from every side.
 */
const TODAY = "2026-10-20";

describe("dueBucketOn", () => {
  it("is overdue only before today; the due date itself is not late", () => {
    expect(dueBucketOn({ dueDate: "2026-10-19" }, TODAY)).toBe("overdue");
    expect(dueBucketOn({ dueDate: "2026-10-20" }, TODAY)).toBe("due_today");
    expect(dueBucketOn({ dueDate: "2026-10-21" }, TODAY)).toBe("not_due");
  });

  it("calls last session's balance overdue whatever its date", () => {
    expect(dueBucketOn({ dueDate: "2027-01-20", isCarryForward: true }, TODAY)).toBe("overdue");
  });

  it("reads a timestamp as its day and an empty date as not due", () => {
    expect(isPendingOn({ dueDate: "2026-10-19T00:00:00+05:30" }, TODAY)).toBe(true);
    expect(dueBucketOn({ dueDate: null }, TODAY)).toBe("not_due");
  });
});

describe("balanceStatusOn", () => {
  it("turns a stale 'pending' into 'overdue' the morning after the due date", () => {
    const row = { balanceStatus: "pending" as const, dueDate: "2026-10-20", pendingAmount: 7_250, feeSettledAmount: 0 };
    expect(balanceStatusOn(row, "2026-10-21")).toBe("overdue");
    expect(balanceStatusOn(row, "2026-10-20")).toBe("pending");
  });

  it("keeps paid and waived, and a part-paid row not yet due is partial", () => {
    expect(balanceStatusOn({ balanceStatus: "waived", dueDate: "2026-04-20", pendingAmount: 500 }, TODAY)).toBe("waived");
    expect(balanceStatusOn({ balanceStatus: "partial", dueDate: "2027-01-20", pendingAmount: 500, feeSettledAmount: 100 }, TODAY)).toBe("partial");
    expect(balanceStatusOn({ balanceStatus: "overdue", dueDate: "2026-07-20", pendingAmount: 0 }, TODAY)).toBe("paid");
  });
});

describe("splitFeesByDue", () => {
  it("never adds not-due-yet or due-today into pending today", () => {
    const rows = [
      { dueDate: "2026-07-20", pendingAmount: 2_400 },
      { dueDate: "2026-10-20", pendingAmount: 4_000 },
      { dueDate: "2027-01-20", pendingAmount: 4_000 },
      { dueDate: "2026-04-20", pendingAmount: 900, balanceStatus: "waived" },
    ];
    expect(splitFeesByDue(rows, TODAY)).toEqual({ pendingToday: 2_400, dueToday: 4_000, notDueYet: 4_000 });
  });
});

describe("usualDueDate", () => {
  it("names the date most children share, and says when dates vary", () => {
    expect(usualDueDate(["2026-10-20", "2026-10-20", "2026-10-01"])).toEqual({ date: "2026-10-20", varies: true });
    expect(usualDueDate(["2026-10-20"])).toEqual({ date: "2026-10-20", varies: false });
    expect(usualDueDate([])).toEqual({ date: null, varies: false });
  });
});

const bal = (over: Partial<InstallmentBalance>): InstallmentBalance => ({
  studentId: "s1",
  studentName: "Test Child",
  admissionNo: "T1",
  fatherName: null,
  fatherPhone: null,
  classId: "c1",
  classLabel: "Class 1",
  installmentNo: 1,
  dueDate: "2026-04-20",
  pendingAmount: 0,
  lateFeePending: 0,
  studentStatus: "active",
  ...over,
});

describe("every screen agrees on 20 Oct", () => {
  const rows: InstallmentBalance[] = [
    bal({ studentId: "a", installmentNo: 2, dueDate: "2026-07-20", pendingAmount: 2_400 }),
    bal({ studentId: "a", installmentNo: 3, dueDate: "2026-10-20", pendingAmount: 4_000 }),
    bal({ studentId: "a", installmentNo: 4, dueDate: "2027-01-20", pendingAmount: 4_000 }),
    bal({ studentId: "b", installmentNo: 2, dueDate: "2026-07-20", pendingAmount: 1_000 }),
    bal({ studentId: "b", installmentNo: 3, dueDate: "2026-10-01", pendingAmount: 4_000 }),
    bal({ studentId: "c", installmentNo: 3, dueDate: "2026-10-20", pendingAmount: 4_000 }),
  ];

  it("Reports' defaulters leave out an installment due today", () => {
    const d = buildDefaulters(rows, TODAY);
    expect(d.map((r) => [r.studentId, r.pending])).toEqual([
      ["a", 2_400],
      ["b", 5_000],
    ]);
  });

  it("Pending by class counts each child once and names the usual date", () => {
    const cw = buildClasswise(rows, TODAY);
    expect(cw.studentsPendingToday).toBe(2);
    expect(cw.rows[0].studentsPendingToday).toBe(2);
    expect(cw.rows[0].pendingToday).toBe(7_400);
    expect(cw.rows[0].notDueYet).toBe(12_000);
    expect(cw.dueDates[3]).toBe("2026-10-20");
    expect(cw.dueVaries[3]).toBe(true);
    expect(cw.dueNos).toEqual([2, 3]);
    expect(cw.notDueNos).toEqual([3, 4]);
  });

  it("the Desk splits one child the same way", () => {
    const desk = [
      { id: "2", installmentNo: 2, label: "Installment 2", isCarryForward: false, dueDate: "2026-07-20", charge: 4_000, feesPaid: 1_600, feesPending: 2_400, lateFeePending: 0, lateFeeRaw: 0, lateFeeWaived: 0, lateFeeStatus: "none" as const, planPriority: 1 },
      { id: "3", installmentNo: 3, label: "Installment 3", isCarryForward: false, dueDate: "2026-10-20", charge: 4_000, feesPaid: 0, feesPending: 4_000, lateFeePending: 0, lateFeeRaw: 0, lateFeeWaived: 0, lateFeeStatus: "none" as const, planPriority: 1 },
    ];
    expect(isOverdueOn(desk[1], TODAY)).toBe(false);
    expect(isDueOn(desk[1], TODAY)).toBe(true);
    const t = deskTotals(desk, TODAY);
    expect([t.pendingToday, t.dueToday]).toEqual([2_400, 4_000]);
    expect(listPending({ instPending: [0, 2_400, 4_000, 0], baseOutstanding: 6_400, lateOutstanding: 0 }, ["2026-04-20", "2026-07-20", "2026-10-20", "2027-01-20"], TODAY).pendingToday).toBe(2_400);
  });
});
