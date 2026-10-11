import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { renderReceiptPdf } from "@/modules/receipts/domain/receipt-pdf";
import type { ReceiptDetail } from "@/modules/receipts/domain/types";

const receipt: ReceiptDetail = {
  id: "qa-receipt", studentId: "qa-student", receiptNumber: "QA-PDF-RECOVERY", paymentDate: "2026-10-10", paymentMode: "cash",
  totalAmount: 100, referenceNumber: null, notes: "Synthetic font recovery check", receivedBy: "QA Office", createdAt: "2026-10-10T05:00:00Z",
  createdByName: "QA Office", studentFullName: "QA Child", admissionNo: "QA-001", fatherName: "QA Guardian", fatherPhone: null,
  motherPhone: null, familyGroupId: null, parentEmail: null, classLabel: "QA class", sessionLabel: "QA-2026", transportRouteLabel: "",
  studentStatusLabel: "New", feeSummary: [], totalDue: 400, totalPaidBeforeReceipt: 0, totalPaidToDate: 100,
  outstandingAfterReceipt: 300, currentOutstanding: 300, discountAmount: 0, lateFeeAmount: 0, lateFeeWaived: 0,
  breakdown: [], installmentStatus: [], previousReceipts: [], conventionalDiscountAssignments: [],
};
describe("PDF renderer uses the real bundled fonts and assets", () => {
  it.each([false, true])("renders a synthetic receipt, reversed=%s, without font/module failures", async isVoided => {
    const pdf = await renderReceiptPdf({ receipt: { ...receipt, isVoided, voidReason: isVoided ? "QA reversal" : null } });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(20_000);
    expect(pdf.toString("latin1")).toContain("/FontFile2");
    expect(pdf.toString("latin1")).toMatch(/\/Type \/Page\b/);
  }, 30_000);
});
