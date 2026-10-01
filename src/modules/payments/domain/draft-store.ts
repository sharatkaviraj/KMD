import { draftKey, readDraft } from "@/platform/drafts/policy";
import { loadDraft as read, saveDraft as write, removeDraft } from "@/platform/drafts/store";

export type PaymentDraftKeyParts = { ownerId: string; sessionLabel: string; studentId: string; paymentDate: string };
export type PaymentDraftValue = { amountInput: string; paymentMode: string; referenceNumber: string };
type SaveDraftPayload = PaymentDraftKeyParts & { draft: PaymentDraftValue };
export function buildPaymentDraftKey({ ownerId, sessionLabel, studentId, paymentDate }: PaymentDraftKeyParts) {
  return draftKey(ownerId, sessionLabel, `payment/${studentId}/${paymentDate}`);
}
function valid(value: unknown): value is PaymentDraftValue {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PaymentDraftValue>;
  return typeof draft.amountInput === "string" && ["cash", "upi", "bank_transfer", "cheque"].includes(draft.paymentMode ?? "") && typeof draft.referenceNumber === "string";
}
export async function loadDraft(parts: PaymentDraftKeyParts): Promise<PaymentDraftValue | null> {
  return readDraft(await read(buildPaymentDraftKey(parts)), valid)?.value ?? null;
}
export async function saveDraft({ draft, ...parts }: SaveDraftPayload): Promise<void> {
  await write(buildPaymentDraftKey(parts), { version: 1, baseline: parts.sessionLabel, value: draft, updatedAt: Date.now() });
}
export const clearDraft = (parts: PaymentDraftKeyParts) => removeDraft(buildPaymentDraftKey(parts));
