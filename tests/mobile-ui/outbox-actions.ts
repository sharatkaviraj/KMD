import { p, type Pair } from "@/vx/text";
export type OutboxResult = { ok: true; message: Pair; link?: string } | { ok: false; message: Pair };
export const qaOutboxState = { status: "queued" as "queued" | "sent", prepared: 0, confirmed: 0 };
export async function sendByHandAction(input: { source: string; id: string; confirmed?: boolean }): Promise<OutboxResult> {
  if (input.confirmed === true) { qaOutboxState.confirmed += 1; qaOutboxState.status = "sent"; }
  else qaOutboxState.prepared += 1;
  window.dispatchEvent(new Event("qa:outbox-change"));
  return input.confirmed ? { ok: true, message: p("Marked sent by you", "आपके भेजने की पुष्टि दर्ज हुई") }
    : { ok: true, link: "https://qa.invalid/handoff", message: p("Confirm after sending", "भेजने के बाद पुष्टि करें") };
}
const refuse = async (): Promise<OutboxResult> => ({ ok: false, message: p("Synthetic action refused", "परीक्षण में कार्य रोका गया") });
export const undoSentAction = refuse;
export const approveCalendarNoticeAction = refuse;
export const declineCalendarNoticeAction = refuse;
export const prepareReminderBatchAction = refuse;
