import type { DeskPostInput } from "@/app/(app)/payments/actions";
import { draftKey, readDraft, isStringRecord } from "@/platform/drafts/policy";
import { loadDraft, saveDraft, removeDraft } from "@/platform/drafts/store";

export type PaymentAttempt = { input: DeskPostInput; form: Record<string, string> };
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
  const attempt = readDraft(await loadDraft(key), valid)?.value ?? null;
  return attempt?.input.sessionLabel === session ? attempt : null;
}
/** Confirm storage before calling the posting action, even on the first attempt. */
export async function writePaymentAttempt(key: string, attempt: PaymentAttempt) {
  await saveDraft(key, { version: 1, baseline: attempt.input.sessionLabel, value: attempt, updatedAt: Date.now() });
}
export const clearPaymentAttempt = removeDraft;
