import type { PaymentEntryPageData, PaymentDeskStudentSummary } from "@/modules/payments/domain/types";

export const draftStudents = ["a", "b", "c"].map(id => ({ id, fullName: `Synthetic student ${id}`, admissionNo: `QA-${id}`, classId: "qa-class", classLabel: "QA class", studentStatus: "active" }));
export function draftSummary(id = "a", paymentDate = new Date().toISOString().slice(0, 10)): PaymentDeskStudentSummary {
  return { student: { ...draftStudents.find(s => s.id === id)!, fatherName: null, fatherPhone: null, motherPhone: null,
    studentStatusLabel: "Active", transportRouteLabel: "None", breakdown: [], totalDue: 900, totalPaid: 0, totalPending: 900,
    baseOutstandingAmount: 900, lateFeeOutstandingAmount: 0, creditBalance: 0, overpaidAmount: 0, refundableAmount: 0,
    rowsKeptForReview: 0, overdueAmount: 0, nextDueInstallmentLabel: null, nextDueDate: null, nextDueAmount: null },
    issue: null, latestReceipt: null, suggestedDefaultAmount: null, paymentDate };
}
export const draftPageData: PaymentEntryPageData = {
  studentIndex: draftStudents, initialStudentId: "a", initialClassId: "qa-class", initialStudentSummary: draftSummary().student,
  initialStudentIssue: null, initialLatestReceipt: null, modeOptions: [{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }],
  sessionLabel: "QA-2026", policyNote: "Synthetic browser fixture", recentReceipts: [],
  todayCollection: { receiptCount: 0, totalAmount: 0, writtenOffAmount: 0 },
};
