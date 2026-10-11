import { draftSummary } from "../payment-draft.fixture";
export function collectorSummary(id = "a", paymentDate?: string) {
  const summary = draftSummary(id, paymentDate);
  return { ...summary, student: summary.student ? { ...summary.student, breakdown: [{
    installmentId: `ops-fee-installment-${id}`, installmentNo: 1, installmentLabel: "Synthetic installment", dueDate: "2026-07-20",
    amountDue: 900, paymentsTotal: 0, adjustmentsTotal: 0, outstandingAmount: 900, feesPending: 900,
    lateFeePending: 0, rawLateFee: 0, waiverApplied: 0, finalLateFee: 0, balanceStatus: "pending" as const,
  }] } : null };
}
