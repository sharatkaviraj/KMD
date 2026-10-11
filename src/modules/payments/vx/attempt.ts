import type { DeskPostInput } from "@/app/(app)/payments/actions";
import { draftKey, readDraft, isStringRecord } from "@/platform/drafts/policy";
import { loadFinancialDraft, saveFinancialDraft, removeDraft } from "@/platform/drafts/store";

export type PaymentAttempt = { input: DeskPostInput; form: Record<string, string> };
export class PaymentAttemptConflict extends Error {
  constructor(readonly attempt: PaymentAttempt) { super("Another payment is still unresolved in this browser."); }
}
export class PaymentRecoveryUnavailable extends Error {
  constructor() { super("This browser cannot protect payment recovery across tabs."); }
}
export function paymentAttemptKey(owner: string, session: string) { return draftKey(owner, session, "payment-attempt"); }
function valid(value: unknown): value is PaymentAttempt {
  if (!value || typeof value !== "object") return false;
  const a = value as Partial<PaymentAttempt>;
  if (!a.input || !isStringRecord(a.form)) return false;
  const i = a.input;
  return typeof i.clientRequestId === "string" && typeof i.studentId === "string" && typeof i.sessionLabel === "string"
    && typeof i.paymentDate === "string" && ["cash", "upi", "bank_transfer", "cheque"].includes(i.mode)
    && Number.isSafeInteger(i.amount) && i.amount > 0 && Number.isSafeInteger(i.lateFeeWaiver) && i.lateFeeWaiver >= 0
    && Number.isSafeInteger(i.quickDiscountAmount ?? 0) && (i.quickDiscountAmount ?? 0) >= 0
    && [i.reference, i.remarks, i.receivedBy].every(v => typeof v === "string") && typeof i.acknowledgeDuplicate === "boolean";
}
export async function readPaymentAttempt(key: string, session: string) {
  const attempt = await storedAttempt(key);
  if (attempt && attempt.input.sessionLabel !== session) throw new Error("Payment recovery belongs to a different session.");
  return attempt;
}
async function storedAttempt(key: string) {
  const raw = await loadFinancialDraft(key);
  const attempt = readDraft(raw, valid)?.value ?? null;
  if (raw !== null && raw !== undefined && !attempt) throw new Error("Payment recovery could not be read safely.");
  return attempt;
}
/** Verify that recovery can coordinate with other tabs before enabling collection. */
export function restorePaymentAttempt(key: string, session: string) {
  return withAttemptLock(key, () => readPaymentAttempt(key, session));
}
/** Confirm storage before calling the posting action, even on the first attempt. */
export async function writePaymentAttempt(key: string, attempt: PaymentAttempt) {
  return withAttemptLock(key, async () => {
    const current = await storedAttempt(key);
    if (current) {
      const fields: Array<keyof DeskPostInput> = ["clientRequestId", "studentId", "sessionLabel", "paymentDate", "mode", "amount", "quickDiscountAmount", "lateFeeWaiver", "reference", "remarks", "receivedBy"];
      if (fields.some(field => current.input[field] !== attempt.input[field]) || (current.input.acknowledgeDuplicate && !attempt.input.acknowledgeDuplicate)) throw new PaymentAttemptConflict(current);
    }
    await saveFinancialDraft(key, { version: 1, baseline: attempt.input.sessionLabel, value: attempt, updatedAt: Date.now() });
  });
}
export async function clearPaymentAttempt(key: string, requestId: string) {
  return withAttemptLock(key, async () => {
    const current = await storedAttempt(key);
    if (current?.input.clientRequestId === requestId) await removeDraft(key);
  });
}
async function withAttemptLock<T>(key: string, work: () => Promise<T>) {
  if (typeof navigator.locks?.request !== "function") throw new PaymentRecoveryUnavailable();
  let entered = false;
  try {
    return await navigator.locks.request(`payment-recovery:${key}`, () => { entered = true; return work(); });
  } catch (error) {
    // Distinguish an unavailable/denied browser lock from a storage failure inside it.
    if (!entered) throw new PaymentRecoveryUnavailable();
    throw error;
  }
}
