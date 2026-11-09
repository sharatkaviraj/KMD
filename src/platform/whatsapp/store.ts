import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { switchesFromFlags, type TemplateRow, type WhatsAppSwitches } from "@/platform/whatsapp/policy";

/**
 * The WhatsApp log's reads and writes, with the service role (D-562).
 *
 * Every table here is service-role only (migration 20261109062459): the app
 * checks the staff member's permission first and then comes here. Reads that
 * fail answer null, and the policy refuses on null.
 */

export type MessageRow = {
  id: string;
  created_at: string;
  updated_at: string;
  feature: string;
  kind: "template" | "text";
  template_key: string | null;
  provider_template_name: string | null;
  language_code: string | null;
  to_e164: string;
  to_name: string | null;
  body_params: string[];
  header: { type: "document"; url: string; filename: string } | null;
  button_params: string[];
  text_body: string | null;
  session_label: string | null;
  source_table: string | null;
  source_id: string | null;
  requested_by: string | null;
  status: MessageStatus;
  dry_run: boolean;
  provider: string | null;
  provider_message_id: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  error_code: string | null;
  error_title: string | null;
  error_detail: string | null;
  http_status: number | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  pay_code: string | null;
  paid_at: string | null;
  paid_receipt_id: string | null;
  idempotency_key: string | null;
  retry_of: string | null;
  retried_at: string | null;
  retried_by: string | null;
};

export type MessageStatus =
  | "dry_run"
  | "held"
  | "queued"
  | "sending"
  | "retry_wait"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "unknown"
  | "cancelled";

export const SWITCH_KEYS = [
  "whatsapp_dry_run",
  "whatsapp_features",
  "whatsapp_real_recipients",
  "whatsapp_owner_test_number",
  "whatsapp_daily_limit",
] as const;

type Db = ReturnType<typeof createAdminClient>;

export function whatsappDb(): Db {
  return createAdminClient();
}

export async function readSwitches(db: Db = whatsappDb()): Promise<WhatsAppSwitches | null> {
  try {
    const { data, error } = await db.from("runtime_flags").select("key, enabled, value").in("key", [...SWITCH_KEYS]);
    if (error || !data) return null;
    return switchesFromFlags(data as Array<{ key: string; enabled: boolean | null; value: unknown }>);
  } catch {
    return null;
  }
}

export async function readTemplateRow(key: string, db: Db = whatsappDb()): Promise<TemplateRow | null> {
  const { data, error } = await db
    .from("whatsapp_templates")
    .select("key, provider_name, language_code, feature, body_params, header, url_button, status")
    .eq("key", key)
    .maybeSingle<TemplateRow>();
  if (error) return null;
  return data ?? null;
}

/** Did this number write to the school in the last 24 hours? null when unreadable. */
export async function wroteWithin24h(e164: string, db: Db = whatsappDb()): Promise<boolean | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("whatsapp_inbound")
    .select("id")
    .eq("from_e164", e164)
    .gte("received_at", since)
    .limit(1);
  if (error) return null;
  return (data ?? []).length > 0;
}

export type ClaimAnswer =
  | { ok: true; id: string; status: MessageStatus }
  | { ok: false; reason: "duplicate"; id: string; status: MessageStatus; provider_message_id: string | null }
  | { ok: false; reason: "daily_limit"; id: string }
  | { ok: false; reason: "claim_failed"; message: string };

export async function claimSend(
  message: Record<string, unknown>,
  status: "sending" | "queued" | "dry_run" | "held",
  dailyLimit: number,
  db: Db = whatsappDb(),
): Promise<ClaimAnswer> {
  const { data, error } = await db.rpc("whatsapp_claim_send", {
    p_message: message,
    p_status: status,
    p_daily_limit: dailyLimit,
  });
  if (error || !data || typeof data !== "object") {
    return { ok: false, reason: "claim_failed", message: error?.message ?? "No answer from whatsapp_claim_send." };
  }
  return data as ClaimAnswer;
}

export type AttemptWrite = {
  status: MessageStatus;
  providerMessageId?: string | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorTitle?: string | null;
  errorDetail?: string | null;
  nextAttemptAt?: string | null;
  attempts: number;
  provider: string | null;
};

/** What one attempt came back with, on the row and as an event. */
export async function recordAttempt(id: string, write: AttemptWrite, db: Db = whatsappDb()): Promise<void> {
  const now = new Date().toISOString();
  await db
    .from("whatsapp_messages")
    .update({
      status: write.status,
      provider: write.provider,
      provider_message_id: write.providerMessageId ?? null,
      http_status: write.httpStatus ?? null,
      error_code: write.errorCode ?? null,
      error_title: write.errorTitle ?? null,
      error_detail: write.errorDetail ?? null,
      attempts: write.attempts,
      last_attempt_at: now,
      next_attempt_at: write.nextAttemptAt ?? null,
      ...(write.status === "failed" ? { failed_at: now } : {}),
      updated_at: now,
    })
    .eq("id", id);
  await db.from("whatsapp_message_events").insert({
    message_id: id,
    provider_message_id: write.providerMessageId ?? null,
    event: "send",
    status: write.status,
    error_code: write.errorCode ?? null,
    error_title: write.errorTitle ?? null,
    occurred_at: now,
    detail: { attempt: write.attempts, http_status: write.httpStatus ?? null, provider: write.provider },
  });
}

export async function readMessage(idOrProviderId: string, db: Db = whatsappDb()): Promise<MessageRow | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrProviderId);
  const { data, error } = await db
    .from("whatsapp_messages")
    .select("*")
    .eq(isUuid ? "id" : "provider_message_id", idOrProviderId)
    .maybeSingle<MessageRow>();
  if (error) return null;
  return data ?? null;
}

export async function takeDue(limit: number, db: Db = whatsappDb()): Promise<MessageRow[]> {
  const { data, error } = await db.rpc("whatsapp_take_due", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return data as MessageRow[];
}

/**
 * Messages the hub has not reported on, due for a `GET /v1/status/{wamid}`
 * (`whatsapp_take_pollable`, which stamps each one so two runs never ask
 * twice, and stops after the fourth ask).
 */
export async function takePollable(limit: number, db: Db = whatsappDb()): Promise<MessageRow[]> {
  const { data, error } = await db.rpc("whatsapp_take_pollable", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return data as MessageRow[];
}

export type StatusAnswer = {
  matched: boolean;
  changed: boolean;
  id: string | null;
  previous: string | null;
  source_table: string | null;
  source_id: string | null;
};

export async function recordStatus(
  args: {
    providerMessageId: string;
    status: "sent" | "delivered" | "read" | "failed";
    at: string | null;
    errorCode: string | null;
    errorTitle: string | null;
    detail: Record<string, unknown> | null;
  },
  db: Db = whatsappDb(),
): Promise<StatusAnswer | null> {
  const { data, error } = await db.rpc("whatsapp_record_status", {
    p_provider_message_id: args.providerMessageId,
    p_status: args.status,
    p_at: args.at,
    p_error_code: args.errorCode,
    p_error_title: args.errorTitle,
    p_detail: args.detail,
  });
  if (error || !data) return null;
  return data as StatusAnswer;
}

export async function storeInbound(
  row: {
    provider_message_id: string;
    from_e164: string;
    from_name: string | null;
    message_type: string;
    text_body: string | null;
    reply_to_provider_id: string | null;
    received_at: string;
    payload: Record<string, unknown>;
  },
  db: Db = whatsappDb(),
): Promise<boolean> {
  let replyTo: string | null = null;
  if (row.reply_to_provider_id) {
    const { data } = await db
      .from("whatsapp_messages")
      .select("id")
      .eq("provider_message_id", row.reply_to_provider_id)
      .maybeSingle<{ id: string }>();
    replyTo = data?.id ?? null;
  }
  const { error } = await db
    .from("whatsapp_inbound")
    .upsert({ ...row, reply_to_message_id: replyTo }, { onConflict: "provider_message_id", ignoreDuplicates: true });
  return !error;
}

/**
 * Razorpay confirmed a payment that came from a Pay now link: the message that
 * carried that link is marked paid. Never sent again for that, never deleted.
 */
export async function markPaidByPayCode(
  payCode: string,
  receiptId: string | null,
  db: Db = whatsappDb(),
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("whatsapp_messages")
    .update({ paid_at: now, paid_receipt_id: receiptId, updated_at: now })
    .eq("pay_code", payCode)
    .is("paid_at", null)
    .select("id, provider_message_id");
  if (error || !Array.isArray(data)) return 0;
  for (const row of data as Array<{ id: string; provider_message_id: string | null }>) {
    await db.from("whatsapp_message_events").insert({
      message_id: row.id,
      provider_message_id: row.provider_message_id,
      event: "paid",
      occurred_at: now,
      detail: { receipt_id: receiptId },
    });
  }
  return data.length;
}

/** The queue timer's Bearer secret, checked against Vault in Postgres (never copied to Vercel). */
export async function queueSecretMatches(secret: string, db: Db = whatsappDb()): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(secret)) return false;
  const { data, error } = await db.rpc("whatsapp_queue_secret_matches", { p_secret: secret });
  return !error && data === true;
}

/**
 * Practice mode on or off, from Settings → WhatsApp. The only two switches a
 * screen may change; real recipients and the owner's test number are never
 * among them.
 */
export async function setPracticeMode(on: boolean, staffId: string, db: Db = whatsappDb()): Promise<boolean> {
  const { error } = await db
    .from("runtime_flags")
    .update({ enabled: on, updated_by: staffId, updated_at: new Date().toISOString() })
    .eq("key", "whatsapp_dry_run");
  return !error;
}

/** One feature's switch in `whatsapp_features`, read and written back whole. */
export async function setFeatureSwitch(feature: string, on: boolean, staffId: string, db: Db = whatsappDb()): Promise<boolean> {
  const { data, error } = await db.from("runtime_flags").select("value").eq("key", "whatsapp_features").maybeSingle<{ value: unknown }>();
  if (error || !data || !data.value || typeof data.value !== "object" || Array.isArray(data.value)) return false;
  const value = { ...(data.value as Record<string, unknown>), [feature]: on };
  const { error: writeError } = await db
    .from("runtime_flags")
    .update({ value, updated_by: staffId, updated_at: new Date().toISOString() })
    .eq("key", "whatsapp_features");
  return !writeError;
}
