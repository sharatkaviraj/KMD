import type { DeskBoot, DeskCheckResult, DeskReceipt, DeskSaveResult, DeskStudent, DeskStudentResult } from "@/modules/payments/vx/types";
import type { DeskMode } from "@/modules/payments/vx/domain/desk";
const today = "2026-10-11";
const role = new URLSearchParams(location.search).get("role") ?? "feeCollector";
// Stable synthetic principals keep durable drafts separate without creating
// accounts. The missing-owner case deliberately exercises the product guard.
const fixtureMe = {
  id: role === "missing-owner" ? "" : `ops-fee-20261011-${role}`,
  name: role === "admin" ? "Synthetic fee admin" : role === "accountant" ? "Synthetic accountant" : "Synthetic fee clerk",
  isAdmin: role === "admin",
  canWaive: role === "admin" || role === "accountant",
  canRemove: role === "admin",
  canBulk: role === "admin",
};
export const boot: DeskBoot = {
  sessionLabel: "QA-2026", today, sessionStart: "2026-04-01", canPost: true, blocking: null,
  modes: ["cash", "upi", "bank_transfer", "cheque"], classes: [{ id: "ops-class", label: "Synthetic class", short: "QA" }],
  students: ["a", "b"].map(id => ({ id, name: `Synthetic fee student ${id}`, sr: `OPS-${id}`, classId: "ops-class", classLabel: "Synthetic class", father: null, phone: null, pendingToday: 600, lateFee: 100 })),
  todayCollection: { count: 0, amount: 0 }, lateFeeFlat: 100,
  me: fixtureMe,
};
export function student(id = "a"): DeskStudent {
  return { id, name: `Synthetic fee student ${id}`, sr: `OPS-${id}`, classLabel: "Synthetic class", father: null, phone: null, route: null, isNew: false, onPlan: false,
    rows: [{ id: "ops-overdue", installmentNo: 1, label: "Synthetic installment 1", isCarryForward: false, dueDate: "2026-07-20", charge: 600, feesPaid: 0, feesPending: 600, lateFeePending: 100, lateFeeRaw: 100, lateFeeWaived: 0, lateFeeStatus: "pending", planPriority: 1 },
      { id: "ops-future", installmentNo: 2, label: "Synthetic installment 2", isCarryForward: false, dueDate: "2027-01-20", charge: 300, feesPaid: 0, feesPending: 300, lateFeePending: 0, lateFeeRaw: 0, lateFeeWaived: 0, lateFeeStatus: "none", planPriority: 1 }],
    receipts: [], siblings: [], plan: null, readAt: `${today}T10:00:00Z` };
}
type Record = { clientRequestId: string; studentId: string; amount: number; mode: DeskMode; paymentDate: string; reference: string; remarks: string; lateFeeWaiver: number; receivedBy: string; receipt: DeskReceipt; removed?: boolean };
const key = "ops-fee-vx-20261011-ledger";
const read = (): Record[] => JSON.parse(localStorage.getItem(key) ?? "[]");
function saved(row: Record): Extract<DeskSaveResult, { status: "saved" }> {
  return { status: "saved", receipt: row.receipt, receiptId: row.receipt.id, receiptNumber: row.receipt.receiptNumber, student: null, balanceAfter: { pendingToday: Math.max(0, 600 - row.amount), dueToday: 0, notDueYet: 300, lateFee: row.lateFeeWaiver > 0 ? 0 : 100 } };
}
export async function loadStudentDeskAction({ studentId }: { studentId: string }): Promise<DeskStudentResult> { return { ok: true, student: student(studentId) }; }
export async function postDeskPaymentAction(input: Omit<Record, "receipt">): Promise<DeskSaveResult> {
  const rows = read(); let row = rows.find(r => r.clientRequestId === input.clientRequestId);
  if (!row) {
    const receipt: DeskReceipt = { id: `ops-vx-${rows.length + 1}`, receiptNumber: `OPS-VX-${rows.length + 1}`, studentId: input.studentId, studentName: student(input.studentId).name, sr: `OPS-${input.studentId}`, classLabel: "Synthetic class", father: null, phone: null, paymentDate: input.paymentDate, createdAt: `${today}T10:00:00Z`, mode: input.mode, reference: input.reference, notes: input.remarks, receivedBy: input.receivedBy, total: input.amount, lines: [{ label: "Synthetic fees", amount: input.amount }], lateFeePaid: 0, lateFeeWaived: input.lateFeeWaiver, isReversed: false, outstandingAfter: 1000 - input.amount - input.lateFeeWaiver };
    row = { ...input, receipt }; rows.push(row); localStorage.setItem(key, JSON.stringify(rows));
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  if (new URLSearchParams(location.search).get("uncertain") === "yes" && !sessionStorage.getItem("ops-fee-vx-response-delivered")) {
    sessionStorage.setItem("ops-fee-vx-response-delivered", "yes");
    return { status: "uncertain", message: "Synthetic response interrupted after commit" };
  }
  return saved(row);
}
export async function checkDeskPaymentAction(input: { studentId: string; clientRequestId: string }): Promise<DeskCheckResult> {
  const checks = JSON.parse(localStorage.getItem("ops-fee-vx-checks") ?? "[]"); checks.push(input); localStorage.setItem("ops-fee-vx-checks", JSON.stringify(checks));
  if (!sessionStorage.getItem("ops-fee-vx-check-available")) return { status: "unknown", message: "Synthetic check unavailable" };
  const row = read().find(r => r.clientRequestId === input.clientRequestId && r.studentId === input.studentId);
  return row ? saved(row) : { status: "not_saved" };
}
export async function loadReceiptAction(id: string) { return read().find(r => r.receipt.id === id)?.receipt ?? null; }
export async function removePaymentAction({ receiptId }: { receiptId: string }) {
  const rows = read(); const row = rows.find(r => r.receipt.id === receiptId);
  if (!row) return { ok: false, message: "Synthetic receipt not found" };
  row.removed = true; row.receipt.isReversed = true; localStorage.setItem(key, JSON.stringify(rows)); return { ok: true, message: "Synthetic entry reversed" };
}
export async function sendReceiptWhatsappAction() {
  localStorage.setItem("ops-fee-vx-messaging-attempts", String(Number(localStorage.getItem("ops-fee-vx-messaging-attempts") ?? "0") + 1));
  throw new Error("Messaging prohibited in operational synthetic fixture");
}
