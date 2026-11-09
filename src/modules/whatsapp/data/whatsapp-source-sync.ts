import "server-only";

import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { applyDeliveryResult } from "@/modules/whatsapp/data/delivery-store";
import { STATUS_RANK, type DeliveryStatus } from "@/modules/whatsapp/domain/delivery-report";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import type { SendOutcome } from "@/platform/whatsapp/service";
import { markPaidByPayCode, type MessageRow } from "@/platform/whatsapp/store";

/**
 * What the school's WhatsApp log learns, carried back to the row that asked
 * for the message (D-562).
 *
 * The log (`vppsone.whatsapp_messages`) knows every message; the fee screens
 * read their own rows (`whatsapp_reminder_sends`, `school_notice_sends`). This
 * is the one place the two meet, in the fee module because those tables are
 * the fee schema's:
 *
 *  - a delivery update from the webhook lands on the reminder row the same
 *    way the old AiSensy webhook wrote it, never moving a status backwards;
 *  - a queued school notice gets its final answer when the queue sends it;
 *  - a Razorpay payment marks the message that carried its Pay now link paid.
 *
 * Nothing here sends anything, and nothing here writes money.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type WebhookStatusForSource = {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: string | null;
  errorCode: string | null;
  errorTitle: string | null;
  sourceTable: string | null;
  sourceId: string | null;
};

const REMINDER_STATUS: Record<WebhookStatusForSource["status"], DeliveryStatus> = {
  sent: "submitted",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/** One webhook status onto the module row it belongs to. True when a row changed. */
export async function syncDeliveryToSource(update: WebhookStatusForSource, supabase: Db = createAdminClient()): Promise<boolean> {
  if (update.sourceTable === "whatsapp_reminder_sends" || update.sourceTable === null) {
    // Only a row this app actually sent. A `covered_by_sibling` row carries its
    // sibling's id, and writing to both would report one message as several.
    const { data: rows } = await supabase
      .from("whatsapp_reminder_sends")
      .select("id, delivery_status")
      .eq("provider_message_id", update.providerMessageId)
      .eq("status", "sent");
    const target = ((rows ?? []) as Array<{ id: string; delivery_status: string | null }>)[0];
    if (!target) return false;
    const status = REMINDER_STATUS[update.status];
    // Never backwards: webhooks arrive out of order.
    const current = target.delivery_status ? (STATUS_RANK[target.delivery_status as DeliveryStatus] ?? 0) : 0;
    if (STATUS_RANK[status] <= current) return false;
    await applyDeliveryResult(supabase, {
      id: target.id,
      status,
      at: update.at,
      ...(status === "failed"
        ? {
            ...(update.errorTitle ? { reason: update.errorTitle } : {}),
            ...(update.errorCode ? { errorCode: update.errorCode } : {}),
          }
        : {}),
    });
    return true;
  }

  if (update.sourceTable === "school_notice_sends" && update.sourceId && update.status === "failed") {
    // A notice WhatsApp could not deliver reached nobody: the row goes back to
    // `failed`, which is what lets the next press send it again.
    const reason = update.errorTitle ?? "WhatsApp could not deliver it";
    const { data } = await supabase
      .from("school_notice_sends")
      .update({
        status: "failed",
        error_message: update.errorCode ? `${reason} (WhatsApp ${update.errorCode})` : reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", update.sourceId)
      .eq("status", "sent")
      .eq("provider_message_id", update.providerMessageId)
      .select("id");
    return Array.isArray(data) && data.length > 0;
  }
  return false;
}

/**
 * The queue (or a Retry from the WhatsApp log) settled a message: write the
 * answer onto the school notice row that has been waiting for it. Fee reminder
 * rows are never queued (they keep their own same-day retry), so they are not
 * touched here.
 */
export async function syncSettledToSource(row: Pick<MessageRow, "source_table" | "source_id">, outcome: SendOutcome, supabase: Db = createAdminClient()): Promise<void> {
  if (row.source_table !== "school_notice_sends" || !row.source_id) return;
  if (outcome.outcome === "queued") return;
  const now = new Date().toISOString();
  if (outcome.outcome === "accepted" || (outcome.outcome === "duplicate" && outcome.providerMessageId)) {
    await supabase
      .from("school_notice_sends")
      .update({ status: "sent", provider_message_id: outcome.providerMessageId, error_message: null, updated_at: now })
      .eq("id", row.source_id)
      .in("status", ["pending", "failed"]);
    return;
  }
  const reason =
    outcome.outcome === "rejected" && outcome.code
      ? `${outcome.reason} (WhatsApp ${outcome.code})`
      : "reason" in outcome
        ? outcome.reason
        : "Not sent.";
  await supabase
    .from("school_notice_sends")
    .update({ status: "failed", error_message: reason, updated_at: now })
    .eq("id", row.source_id)
    .eq("status", "pending");
}

/**
 * Razorpay confirmed these payments. Each one that came from a Pay now link
 * names the send it came from (`online_payment_intents.send_id`, or the order's
 * `send_id`); that send's pay code is the code the message carried, and the
 * message is marked paid with the receipt it became. Best effort: a parent's
 * payment is never held up by the message log.
 */
export async function markMessagesPaidForPayments(supabase: Db, paymentIds: readonly string[]): Promise<number> {
  const ids = [...new Set(paymentIds.filter((id) => /^pay_[A-Za-z0-9]+$/.test(id)))];
  if (ids.length === 0) return 0;
  const { data, error } = await supabase
    .from("online_payment_captures")
    .select("provider_payment_id, application_status, receipt_id, online_payment_intents(send_id), online_payment_orders(send_id)")
    .in("provider_payment_id", ids);
  if (error || !Array.isArray(data)) return 0;

  const receiptBySend = new Map<string, string | null>();
  for (const capture of data as Array<{
    application_status: string;
    receipt_id: string | null;
    online_payment_intents?: { send_id?: string | null } | null;
    online_payment_orders?: { send_id?: string | null } | null;
  }>) {
    if (capture.application_status !== "applied") continue;
    const sendId = capture.online_payment_intents?.send_id ?? capture.online_payment_orders?.send_id ?? null;
    if (sendId) receiptBySend.set(sendId, capture.receipt_id ?? null);
  }
  if (receiptBySend.size === 0) return 0;

  const { data: sends } = await fetchInChunks<{ id: string; pay_code: string | null }>([...receiptBySend.keys()], IN_FILTER_CHUNK_SIZE, (chunk) =>
    supabase.from("whatsapp_reminder_sends").select("id, pay_code").in("id", chunk),
  ).catch(() => ({ data: [] as Array<{ id: string; pay_code: string | null }>, error: null }));

  let marked = 0;
  for (const send of sends) {
    if (!send.pay_code) continue;
    marked += await markPaidByPayCode(send.pay_code, receiptBySend.get(send.id) ?? null).catch(() => 0);
  }
  return marked;
}
