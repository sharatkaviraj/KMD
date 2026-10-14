import type { DeskPostInput } from "@/app/(app)/payments/actions";
import { boot, student, OTHER_ID, receipt } from "../payment-parity.fixture";
let posted: DeskPostInput | null = JSON.parse(sessionStorage.getItem("qa-payment-posted") ?? "null");
let receiptCount = Number(sessionStorage.getItem("qa-payment-count") ?? "0");
declare global { interface Window { paymentFixtureSnapshot: () => { posted: DeskPostInput | null; receiptCount: number }; } }
window.paymentFixtureSnapshot = () => ({ posted, receiptCount });
const pending = (input: DeskPostInput) => ({ ...student, id: input.studentId, name: input.studentId === OTHER_ID ? "TEST Child B" : student.name, rows: student.rows.map((r, i) => i === 0 ? { ...r, feesPending: Math.max(0, r.feesPending - input.amount - (input.quickDiscountAmount ?? 0)), feesPaid: input.amount, lateFeePending: Math.max(0, r.lateFeePending - input.lateFeeWaiver) } : r) });
export async function loadStudentDeskAction({ studentId }: { studentId: string }) { return { ok: true as const, student: { ...student, id: studentId, name: studentId === OTHER_ID ? "TEST Child B" : student.name } }; }
export async function loadDeskPreviewAction({ paymentDate }: { paymentDate: string }) { return { ok: true as const, rows: student.rows.map(r => ({ ...r, lateFeePending: paymentDate <= r.dueDate ? 0 : r.lateFeePending })) }; }
export async function postDeskPaymentAction(input: DeskPostInput) {
  if (!posted || posted.clientRequestId !== input.clientRequestId) { posted = input; receiptCount += 1; sessionStorage.setItem("qa-payment-posted", JSON.stringify(posted)); sessionStorage.setItem("qa-payment-count", String(receiptCount)); }
  if (new URLSearchParams(location.search).has("lost") && sessionStorage.getItem("qa-payment-lost") !== "yes") { sessionStorage.setItem("qa-payment-lost", "yes"); throw new Error("Synthetic lost response"); }
  return saved();
}
function saved() {
  if (!posted) throw new Error("No synthetic payment was posted");
  const input = posted;
  const balanceAfter = { pendingToday: Math.max(0, 2000 - input.amount - (input.quickDiscountAmount ?? 0)), dueToday: 0, notDueYet: 2000, lateFee: Math.max(0, 1000 - input.lateFeeWaiver) };
  return { status: "saved" as const, receipt: { ...receipt, studentId: input.studentId, total: input.amount, outstandingAfter: balanceAfter.pendingToday + balanceAfter.notDueYet + balanceAfter.lateFee, receiptNumber: `TEST-${receiptCount}`, paymentDate: input.paymentDate, receivedBy: input.receivedBy, concession: input.quickDiscountAmount ?? 0 }, receiptId: receipt.id, receiptNumber: `TEST-${receiptCount}`, student: pending(input), balanceAfter };
}
export async function checkDeskPaymentAction() {
  if (new URLSearchParams(location.search).has("uncertain") && sessionStorage.getItem("qa-payment-check") !== "yes") return { status: "unknown" as const, message: "Synthetic lookup response lost" };
  return posted ? saved() : { status: "not_saved" as const };
}
export async function loadReceiptAction() { return receipt; }
export async function removePaymentAction() { return { ok: true as const, message: "Synthetic reversal" }; }
export async function settleDeskSaveAction() { return null; }
export async function sendReceiptWhatsappAction() { throw new Error("Synthetic fixture never sends messages"); }
