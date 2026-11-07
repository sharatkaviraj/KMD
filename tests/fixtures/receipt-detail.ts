import type { ReceiptBreakdownItem, ReceiptDetail, ReceiptInstallmentStatusItem } from "@/modules/receipts/domain/types";

/*
 * Synthetic receipts for the receipt template and its PDF. No real child,
 * parent or number: the ordinary one is shaped like a normal TEST-session
 * receipt with two discount policies on file, the heavy one is the longest
 * the office could plausibly post.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const row = (n: number, amount: number, extra: Partial<ReceiptBreakdownItem> = {}): ReceiptBreakdownItem => ({
  paymentId: uuid(100 + n), installmentNo: n, installmentLabel: `Installment ${n} (20-0${n}-2026)`, sessionLabel: "TEST-2026-27",
  dueDate: `2026-0${n}-20`, amount, originalAmount: amount, adjustmentAmount: 0, effectiveAmount: amount, notes: null,
  discountAppliedAtPosting: null, waiverAppliedAtPosting: null, pendingBeforePosting: null, pendingAfterPosting: null, ...extra,
});

const tile = (n: number, label: string, status: ReceiptInstallmentStatusItem["status"], pending: number): ReceiptInstallmentStatusItem => ({
  installmentNo: n, label, dueDate: `2026-0${n}-20`, expected: 6000, paid: 6000 - pending, pending, lateFee: 0, status,
});

export const ordinaryReceipt: ReceiptDetail = {
  id: uuid(1), studentId: uuid(2), receiptNumber: "SVP20991231-0001", paymentDate: "2026-05-16", paymentMode: "cash",
  totalAmount: 6000, referenceNumber: null, notes: null, receivedBy: "QA Office", createdAt: "2026-05-16T05:00:00Z",
  createdByName: "QA Office", studentFullName: "QA Child", admissionNo: "TEST-CL2-705", fatherName: "QA Guardian", fatherPhone: "9999900000",
  motherPhone: null, familyGroupId: null, parentEmail: null, classLabel: "Class 7", sessionLabel: "TEST-2026-27", transportRouteLabel: "",
  studentStatusLabel: "Old", feeSummary: [], totalDue: 6500, totalPaidBeforeReceipt: 0, totalPaidToDate: 6000,
  outstandingAfterReceipt: 1500, currentOutstanding: 1500, discountAmount: 0, lateFeeAmount: 1000, lateFeeWaived: 1000,
  breakdown: [row(1, 2000), row(2, 1500), row(3, 1500), row(4, 1000)],
  installmentStatus: [
    tile(1, "Installment 1 (20-04-2026)", "paid", 0), tile(2, "Installment 2 (20-07-2026)", "paid", 0),
    tile(3, "Installment 3 (20-10-2026)", "paid", 0), tile(4, "Installment 4 (20-01-2027)", "pending", 1500),
  ],
  previousReceipts: [],
  conventionalDiscountAssignments: [
    { assignmentId: uuid(201), policyCode: "STAFF_CHILD", policyDisplayName: "Staff Child", beforeTuitionAmount: 22000, resultingTuitionAmount: 11000, isWinningPolicy: false },
    { assignmentId: uuid(202), policyCode: "THIRD_CHILD", policyDisplayName: "3rd Child Policy", beforeTuitionAmount: 22000, resultingTuitionAmount: 6000, isWinningPolicy: true },
  ],
};

/** Eight instalment lines with corrections, three policies, a previous-year tile, every note. */
export const heavyReceipt: ReceiptDetail = {
  ...ordinaryReceipt,
  totalAmount: 24000, totalDue: 52000, totalPaidToDate: 30000, outstandingAfterReceipt: 22000, currentOutstanding: 23000,
  discountAmount: 2000,
  breakdown: Array.from({ length: 8 }, (_, i) =>
    row(i + 1, 3000, { pendingBeforePosting: 6000, pendingAfterPosting: 3000, adjustmentAmount: i % 3 === 0 ? -500 : 0, originalAmount: i % 3 === 0 ? 3500 : 3000 })),
  installmentStatus: [
    tile(1, "Previous year tuition balance from 2025-26", "overdue", 4000),
    tile(2, "Installment 1 (20-04-2026)", "paid", 0), tile(3, "Installment 2 (20-07-2026)", "partial", 2000),
    tile(4, "Installment 3 (20-10-2026)", "overdue", 6000), tile(5, "Installment 4 (20-01-2027)", "pending", 6000),
  ],
  conventionalDiscountAssignments: [
    ...ordinaryReceipt.conventionalDiscountAssignments,
    { assignmentId: uuid(203), policyCode: "RTE", policyDisplayName: "RTE", beforeTuitionAmount: 22000, resultingTuitionAmount: 0, isWinningPolicy: false },
  ],
};
