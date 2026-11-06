import { describe, expect, it } from "vitest";
import { buildDuesBoard, familyDetailFrom, leftOwingInSession } from "@/modules/defaulters/vx/domain/board";
import { bridgeDuesSchema, bridgeFeeSetupSchema } from "@/platform/fees-bridge/screen-read-contracts";

const kid = (id: string, extra: Record<string, unknown> = {}) => ({
  studentId: id, fullName: `TEST ${id}`, fatherName: "TEST Father", fatherPhone: null, motherPhone: "9000000000", classLabel: "Class 5",
  transportRouteId: null, overdueAmount: 4000, totalPending: 6000, lateFee: 1000, daysOverdue: 17, familyGroupId: null, lastPaymentDate: null, ...extra,
});

describe("Dues board, one rule for the copy and for Fees", () => {
  it("fills installment numbers, class columns, not-due and contacts", () => {
    const board = buildDuesBoard({
      defaulters: [kid("a"), kid("b", { fatherPhone: "9111111111" })],
      overdue: [
        { studentId: "a", classLabel: "Class 5", installmentNo: 3, pendingAmount: 4000 },
        { studentId: "a", classLabel: "Class 5", installmentNo: 1, isCarryForward: true, pendingAmount: "500" },
        { studentId: "b", classLabel: null, installmentNo: 2, pendingAmount: 0 },
      ],
      notDue: new Map([["a", 2000]]),
      contacts: [["a", { lastContactedAt: "2026-11-05T10:00:00Z", lastOutcome: "promised" }]],
    });
    expect(board.students[0]).toMatchObject({ studentId: "a", fatherPhone: "9000000000", notDueYet: 2000, overdueInstallments: [0, 3] });
    expect(board.students[1]).toMatchObject({ fatherPhone: "9111111111", notDueYet: 0, overdueInstallments: [] });
    expect(board.classByInst).toEqual([{ classLabel: "Class 5", inst1: 0, inst2: 0, inst3: 4000, inst4: 0, other: 0, lastYear: 500, total: 4500 }]);
    expect(board.contacts.a).toEqual({ lastContactedAt: "2026-11-05T10:00:00Z", lastOutcome: "promised", lastChannel: null, snoozeUntil: null });
  });
  it("left owing counts only this session's dues", () => {
    const row = { studentId: "s", fullName: "TEST", fatherName: null, phone: null, status: "left", classLabel: null, lastPaymentDate: null };
    expect(leftOwingInSession([{ ...row, dues: [{ sessionLabel: "TEST-2026-27", remainingAmount: 900 }] }], "2026-27")).toEqual([]);
    expect(leftOwingInSession([{ ...row, dues: [{ sessionLabel: "2026-27", remainingAmount: 900 }, { sessionLabel: null, remainingAmount: 50 }] }], "2026-27")[0].owed).toBe(900);
  });
  it("family panel from Fees rows keeps each child's installments and the newest 20 contacts", () => {
    const detail = familyDetailFrom(["a", "b"], {
      installments: [
        { studentId: "a", admissionNo: "TEST-1", route: "R1", installmentNo: 1, isCarryForward: false, label: "Installment 1", dueDate: "2026-04-20", pendingAmount: 0, lateFeePending: 0, balanceStatus: "paid", baseCharge: 4000 },
        { studentId: "a", admissionNo: "TEST-1", route: "R1", installmentNo: 99, isCarryForward: true, label: "Previous year", dueDate: "2026-04-01", pendingAmount: 500, lateFeePending: 0, balanceStatus: "overdue", baseCharge: 500 },
        { studentId: "x", admissionNo: "TEST-9", route: null, installmentNo: 1, isCarryForward: false, label: "Installment 1", dueDate: "2026-04-20", pendingAmount: 1, lateFeePending: 0, balanceStatus: "overdue", baseCharge: 1 },
      ],
      contacts: Array.from({ length: 25 }, (_, i) => ({ studentId: i % 2 ? "a" : "b", contactedAt: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`, channel: "call", outcome: null, note: null })),
    });
    expect(Object.keys(detail.installments)).toEqual(["a", "b"]);
    expect(detail.installments.a.map((r) => r.no)).toEqual([1, 0]);
    expect(detail.installments.b).toEqual([]);
    expect(detail.meta).toEqual({ a: { admissionNo: "TEST-1", route: "R1" }, b: { admissionNo: null, route: null } });
    expect(detail.contacts).toHaveLength(20);
    expect(detail.contacts[0].at).toBe("2026-10-25T10:00:00Z");
  });
});

describe("screen read contracts", () => {
  const pins = { sessionLabel: "2026-27", asOf: "2026-11-06T05:00:00Z", asOfDate: "2026-11-06" };
  it("parse the Fees answer and refuse a malformed one", () => {
    const dues = { ...pins, defaulters: [kid("a")], contacts: [], overdueRows: [], notDueYet: [{ studentId: "a", amount: 10 }], recovery: [], calledToday: ["a"], collectedWeek: 0 };
    expect(bridgeDuesSchema.parse(dues).calledToday).toEqual(["a"]);
    expect(() => bridgeDuesSchema.parse({ ...dues, collectedWeek: "lots" })).toThrow();
    const setup = { ...pins, draft: { academicSessionLabel: "2026-27", installmentDates: ["2026-04-20"], lateFeeFlatAmount: 1000, newStudentAcademicFeeAmount: 1100,
      oldStudentAcademicFeeAmount: 500, academicFeeDistribution: "first_only", customFeeHeads: [], discounts: [], classRows: [], routeRows: [] },
      studentsByClass: {}, studentsByRoute: {}, activeStudents: 0, paidInstallments: [], ruleStudents: {}, ruleStudentNames: {}, history: [], updatedAt: null };
    expect(bridgeFeeSetupSchema.parse(setup).draft.lateFeeFlatAmount).toBe(1000);
    expect(() => bridgeFeeSetupSchema.parse({ ...setup, draft: { ...setup.draft, academicFeeDistribution: "weekly" } })).toThrow();
  });
});
