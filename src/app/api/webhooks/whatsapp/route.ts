import { NextResponse } from "next/server";

import { syncDeliveryToSource } from "@/modules/whatsapp/data/whatsapp-source-sync";
import { logWarn } from "@/platform/observability/log";
import { webhookSecrets, webhookVerifyToken } from "@/platform/whatsapp/config";
import { recordStatus, storeInbound } from "@/platform/whatsapp/store";
import { parseWebhook, verifySignature } from "@/platform/whatsapp/webhook";

/**
 * The school's WhatsApp webhook (D-562): delivery updates for every message
 * One sent from +91 83022 07823, and the replies parents write back.
 *
 * Meta, or the school's own WhatsApp server in Meta's format, posts here.
 *
 * **A 404 until a signing secret is set** (`WHATSAPP_APP_SECRET` for Meta,
 * `WHATSAPP_WEBHOOK_SECRET` for the school's server), the same rule as the
 * Razorpay hook: until then this is not a route. Every POST must carry
 * `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the exact bytes
 * received; anything else is a 401 and nothing is read.
 *
 * GET is Meta's one-time handshake: it echoes `hub.challenge` when
 * `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`.
 *
 * What it writes:
 *  - each status onto the message log (`whatsapp_record_status`, which never
 *    moves a message backwards) and then onto the row that asked for it — a
 *    fee reminder's delivery tick, a school notice that never arrived;
 *  - each reply into `vppsone.whatsapp_inbound`, linked to the message it
 *    answers. Nothing is sent back automatically.
 *
 * A change for any number but the school's is left unread. A database failure
 * answers 500, so the sender delivers it again; a payload shape this does not
 * understand answers 200, so it is not retried forever.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;
const NOT_HERE = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(request: Request) {
  const token = webhookVerifyToken();
  if (!token || webhookSecrets().length === 0) return NOT_HERE();
  const params = new URL(request.url).searchParams;
  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === token) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(request: Request) {
  const secrets = webhookSecrets();
  if (secrets.length === 0) return NOT_HERE();

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });

  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), secrets)) {
    logWarn("webhook.whatsapp.unauthorized", { reason: "Signature missing or does not match." });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const parsed = parseWebhook(payload);
  let statuses = 0;
  let replies = 0;
  let failedWrites = 0;

  for (const status of parsed.statuses) {
    const answer = await recordStatus({
      providerMessageId: status.providerMessageId,
      status: status.status,
      at: status.at,
      errorCode: status.errorCode,
      errorTitle: status.errorTitle,
      detail: { recipient: status.recipient, error_detail: status.errorDetail },
    }).catch(() => null);
    if (!answer) {
      failedWrites += 1;
      continue;
    }
    if (!answer.matched) continue;
    statuses += 1;
    if (!answer.changed) continue;
    await syncDeliveryToSource({
      providerMessageId: status.providerMessageId,
      status: status.status,
      at: status.at,
      errorCode: status.errorCode,
      errorTitle: status.errorTitle,
      sourceTable: answer.source_table,
      sourceId: answer.source_id,
    }).catch((caught) => {
      logWarn("webhook.whatsapp.source_sync_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    });
  }

  for (const reply of parsed.inbound) {
    const stored = await storeInbound({
      provider_message_id: reply.providerMessageId,
      from_e164: reply.from,
      from_name: reply.fromName,
      message_type: reply.type,
      text_body: reply.text,
      reply_to_provider_id: reply.replyTo,
      received_at: reply.at,
      payload: reply.raw,
    }).catch(() => false);
    if (stored) replies += 1;
    else failedWrites += 1;
  }

  if (failedWrites > 0) {
    logWarn("webhook.whatsapp.write_failed", { failedWrites });
    return NextResponse.json({ ok: false, error: "Could not write everything; send again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, statuses, replies, otherNumber: parsed.otherNumber });
}
