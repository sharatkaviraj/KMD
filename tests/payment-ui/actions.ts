import type { DeskPostInput } from "@/app/(app)/payments/actions";
import { boot, student, OTHER_ID, receipt } from "../payment-parity.fixture";
let posted: DeskPostInput | null = null;
let receiptCount = 0;
const pending = (amount: number) => ({ ...student, rows: student.rows.map((r, i) => i === 0 ? { ...r, feesPending: Math.max(0, r.feesPending - amount), feesPaid: amount } : r) });
export async function loadStudentDeskAction({ studentId }: { studentId: string }) { return { ok: true as const, student: { ...student, id: studentId, name: studentId === OTHER_ID ? "TEST Child B" : student.name } }; }
export async function loadDeskPreviewAction({ paymentDate }: { paymentDate: string }) { return { ok: true as const, rows: student.rows.map(r => ({ ...r, lateFeePending: paymentDate <= r.dueDate ? 0 : r.lateFeePending })) }; }
export async function postDeskPaymentAction(input: DeskPostInput) {
  if (!posted || posted.clientRequestId !== input.clientRequestId) { posted = input; receiptCount += 1; }
  if (new URLSearchParams(location.search).has("lost") && sessionStorage.getItem("qa-payment-lost") !== "yes") { sessionStorage.setItem("qa-payment-lost", "yes"); throw new Error("Synthetic lost response"); }
  return saved();
}
function saved() { const amount = posted?.amount ?? 500; return { status: "saved" as const, receipt: { ...receipt, studentId: posted?.studentId ?? receipt.studentId, total: amount, receiptNumber: `TEST-${receiptCount}`, paymentDate: posted?.paymentDate ?? boot.today, receivedBy: posted?.receivedBy ?? boot.me.name, concession: posted?.quickDiscountAmount ?? 0 }, receiptId: receipt.id, receiptNumber: `TEST-${receiptCount}`, student: pending(amount), balanceAfter: { pendingToday: Math.max(0, 2000 - amount), dueToday: 0, notDueYet: 2000, lateFee: 1000 } }; }
export async function checkDeskPaymentAction() { return posted ? saved() : { status: "not_saved" as const }; }
export async function loadReceiptAction() { return receipt; }
export async function removePaymentAction() { return { ok: true as const, message: "Synthetic reversal" }; }
export async function sendReceiptWhatsappAction() { throw new Error("Synthetic fixture never sends messages"); }
