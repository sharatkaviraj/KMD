import type { DeskPostInput } from "@/app/(app)/payments/actions";
import type { DeskCheckResult, DeskReceipt, DeskSaveResult, DeskStudent, DeskStudentResult } from "@/modules/payments/vx/types";
import { boot as baseBoot, receipt as baseReceipt, student as baseStudent } from "../payment-parity.fixture";

const params = new URLSearchParams(location.search);
const role = params.get("role") ?? "fee_collector";
const effectPrefix = "fee-followup-effect:";
const reversalPrefix = "fee-followup-reversal:";
type Effect = { input: DeskPostInput; receipt: DeskReceipt; balance: { pendingToday: number; dueToday: number; notDueYet: number; lateFee: number } };
type Reversal = { receiptId: string; studentId: string; sessionLabel: string; reason: string };
const effects = (): Effect[] => Object.keys(localStorage).filter(key => key.startsWith(effectPrefix)).map(key => JSON.parse(localStorage.getItem(key)!));
const reversals = (): Reversal[] => Object.keys(localStorage).filter(key => key.startsWith(reversalPrefix)).map(key => JSON.parse(localStorage.getItem(key)!));
const audit = (key: string, value: unknown) => { const rows = JSON.parse(sessionStorage.getItem(key) ?? "[]"); rows.push(value); sessionStorage.setItem(key, JSON.stringify(rows)); };

export const boot = { ...baseBoot, sessionLabel: "FEE-FOLLOWUP-2026-27", me: { ...baseBoot.me, id: `fee-followup-${role}`, name: `Synthetic ${role}`, isAdmin: role === "admin", canWaive: role === "admin" || role === "accountant", canRemove: role === "admin", canBulk: role === "admin" } };
export function student(): DeskStudent {
  const plan = params.has("emi");
  return { ...baseStudent, phone: null, onPlan: plan, rows: plan ? baseStudent.rows.map(row => ({ ...row, lateFeePending: 0, lateFeeWaived: row.lateFeeRaw, lateFeeStatus: row.lateFeeRaw ? "waived" : "none" })) : baseStudent.rows, repaymentPlan: plan ? {
    planId: "fee-followup-plan", scope: "current_year_only", paymentStatus: "behind", monthlyAmount: 700, catchUpAmount: 1400, remainingBalance: 4000,
    nextDueDate: "2026-10-20", nextDueAmount: 700, missedInstallmentCount: 1, planReviewNeeded: false,
    coveredInstallmentIds: baseStudent.rows.map(row => row.id), duesOutsidePlan: null, duesOutsidePlanAmount: 0,
  } : null };
}

declare global {
  interface Window { feeFollowupSnapshot: () => { effects: Effect[]; reversals: Reversal[]; attempts: DeskPostInput[]; checks: { clientRequestId: string; studentId: string }[]; previews: { paymentDate: string }[]; dispatchAttempts: number }; }
}
window.feeFollowupSnapshot = () => ({ effects: effects(), reversals: reversals(), attempts: JSON.parse(sessionStorage.getItem("fee-followup-attempts") ?? "[]"), checks: JSON.parse(sessionStorage.getItem("fee-followup-checks") ?? "[]"), previews: JSON.parse(sessionStorage.getItem("fee-followup-previews") ?? "[]"), dispatchAttempts: Number(sessionStorage.getItem("fee-followup-dispatch") ?? "0") });

// Independent fixed fixture arithmetic; the oracle does not import the UI's
// settlement walker. Each request owns one atomic effect item across reloads.
function makeEffect(input: DeskPostInput): Effect {
  const firstFees = 2000 - (input.quickDiscountAmount ?? 0);
  const firstPaid = Math.min(firstFees, input.amount);
  const lateDue = params.has("emi") || input.paymentDate <= "2026-04-20" || input.lateFeeWaiver ? 0 : 1000;
  const latePaid = Math.min(lateDue, Math.max(0, input.amount - firstPaid));
  const futurePaid = Math.min(2000, Math.max(0, input.amount - firstPaid - latePaid));
  const firstRemaining = firstFees - firstPaid;
  const balance = { pendingToday: input.paymentDate > "2026-04-20" ? firstRemaining : 0, dueToday: 0, notDueYet: 2000 - futurePaid + (input.paymentDate <= "2026-04-20" ? firstRemaining : 0), lateFee: lateDue - latePaid };
  const receipt: DeskReceipt = { ...baseReceipt, id: `fee-followup-${input.clientRequestId}`, receiptNumber: `FOLLOWUP-${input.clientRequestId.slice(0, 8)}`, studentId: input.studentId, createdAt: new Date().toISOString(), paymentDate: input.paymentDate, mode: input.mode, reference: input.reference, notes: input.remarks, receivedBy: input.receivedBy, total: input.amount, concession: input.quickDiscountAmount ?? 0, lateFeePaid: latePaid, lateFeeWaived: input.lateFeeWaiver, phone: null, lines: [{ label: "Installment 1", amount: firstPaid }, ...(latePaid ? [{ label: "Late fee", amount: latePaid }] : []), ...(futurePaid ? [{ label: "Installment 2", amount: futurePaid }] : [])], outstandingAfter: balance.pendingToday + balance.notDueYet + balance.lateFee };
  return { input, receipt, balance };
}
const saved = (effect: Effect): Extract<DeskSaveResult, { status: "saved" }> => ({ status: "saved", receipt: effect.receipt, receiptId: effect.receipt.id, receiptNumber: effect.receipt.receiptNumber, student: null, balanceAfter: effect.balance });
async function transport(kind: string) {
  // This synthetic transport explicitly refuses the emulated browser's offline
  // state before an effect. It never contacts Supabase or a messaging provider.
  if (!navigator.onLine) throw new TypeError("Synthetic transport offline");
  const response = await fetch(`/followup-transport?kind=${kind}`, { method: "POST" });
  if (!response.ok) throw new Error("Synthetic transport unavailable");
}
export async function loadStudentDeskAction(): Promise<DeskStudentResult> { return { ok: true, student: student() }; }
export async function loadDeskPreviewAction(input: { paymentDate: string }) {
  audit("fee-followup-previews", input);
  return { ok: true as const, rows: student().rows.map(row => ({ ...row, lateFeePending: input.paymentDate <= row.dueDate ? 0 : row.lateFeePending })) };
}
export async function postDeskPaymentAction(input: DeskPostInput): Promise<DeskSaveResult> {
  audit("fee-followup-attempts", input);
  await transport("post");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.studentId !== baseStudent.id || input.sessionLabel !== boot.sessionLabel || (input.lateFeeWaiver > 0 && (!boot.me.canWaive || params.has("emi")))) return { status: "error", message: "Synthetic payload or role rejected" };
  let effect = effects().find(row => row.input.clientRequestId === input.clientRequestId);
  if (effect && JSON.stringify(effect.input) !== JSON.stringify(input)) return { status: "error", message: "Synthetic request payload changed" };
  if (!effect) { effect = makeEffect(input); localStorage.setItem(effectPrefix + input.clientRequestId, JSON.stringify(effect)); }
  if (params.has("lost") && sessionStorage.getItem("fee-followup-delivered") !== "yes") { sessionStorage.setItem("fee-followup-delivered", "yes"); return { status: "uncertain", message: "Synthetic answer lost after commit" }; }
  return saved(effect);
}
export async function checkDeskPaymentAction(input: { clientRequestId: string; studentId: string }): Promise<DeskCheckResult> {
  audit("fee-followup-checks", input);
  await transport("check");
  if (params.has("lost") && effects().length && sessionStorage.getItem("fee-followup-check-ready") !== "yes") return { status: "unknown", message: "Synthetic readback unavailable" };
  const effect = effects().find(row => row.input.clientRequestId === input.clientRequestId && row.input.studentId === input.studentId);
  return effect ? saved(effect) : { status: "not_saved" };
}
export async function loadReceiptAction(id: string) { return effects().find(row => row.receipt.id === id)?.receipt ?? null; }
export async function removePaymentAction(input: Reversal) {
  if (role !== "admin") return { ok: false, message: "Synthetic role denied" };
  const effect = effects().find(row => row.receipt.id === input.receiptId);
  if (!effect) return { ok: false, message: "Synthetic receipt missing" };
  localStorage.setItem(reversalPrefix + input.receiptId, JSON.stringify(input));
  return { ok: true, message: "Synthetic reversal recorded" };
}
export async function settleDeskSaveAction() { return null; }
export async function deskDayStateAction() { return { closed: false, closedAt: null }; }
export async function sendReceiptWhatsappAction() { sessionStorage.setItem("fee-followup-dispatch", String(Number(sessionStorage.getItem("fee-followup-dispatch") ?? "0") + 1)); throw new Error("Messages prohibited in synthetic follow-up"); }
