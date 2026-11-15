import "server-only";

import { after, NextResponse } from "next/server";

import { recordChatStatus } from "@/modules/chats/data/store";
import { syncHubTemplates } from "@/modules/whatsapp/data/hub-templates";
import { syncDeliveryToSource } from "@/modules/whatsapp/data/whatsapp-source-sync";
import { isParentFileType } from "@/modules/whatsapp/domain/parent-files";
import { getSiteUrl } from "@/platform/env";
import { vercelOidcToken } from "@/platform/google/vercel-oidc";
import { logWarn } from "@/platform/observability/log";
import { applyTemplateEvents } from "@/platform/whatsapp/service";
import { isReplyToOne, recordStatus, storeInbound } from "@/platform/whatsapp/store";
import { parseWebhook, verifySignature } from "@/platform/whatsapp/webhook";

/**
 * One handler for both WhatsApp webhooks (D-562, D-566):
 *
 *   /api/webhooks/whatsapp      Meta itself, signed with WHATSAPP_APP_SECRET
 *   /api/webhooks/whatsapp-hub  the school's hub, forwarding Meta's JSON
 *                               unchanged, signed with WHATSAPP_HUB_KEY
 *
 * The body is Meta's webhook either way. The signature is checked over the
 * exact bytes before anything is parsed, timing-safe, and nothing is read
 * without it. Then:
 *
 *  - each status goes onto the message log (`whatsapp_record_status`: one row
 *    per message id, never moved backwards, so a repeat or a late "sent"
 *    changes nothing) and from there onto the row that asked for it; one the
 *    log does not know may be a school message in a chat with a parent
 *    (D-616, `parent_chat_status`), forward only the same way;
 *  - each reply TO ONE into `vppsone.whatsapp_inbound`, once per message id.
 *    Whatever else people write to the school's number stays in the hub's own
 *    inbox (`isReplyToOne`), and a status for a message One did not send
 *    leaves no trace here (`whatsapp_record_status`);
 *  - each template event onto the registry. A step down (rejected, paused)
 *    is written at once; an approval only after the hub's own list is read
 *    and checked, after the answer has gone back;
 *  - from the hub only, each message a parent wrote goes to Veer Patta AI
 *    (D-574, `helper-turn.ts`), started at once beside the rest, because the
 *    hub's own bot answers it a few seconds later unless One claims it first.
 *    The helper decides for itself whether to answer, and a repeat of the
 *    same message is never answered twice;
 *  - from the hub only, a parent's photo, voice note, video or document is
 *    copied to the school's Drive beside the rest (D-594, `parent-files.ts`),
 *    when the helper is on and, in practice, only from the owner's number.
 *
 * A database failure answers 500, so the sender delivers it again; a payload
 * this does not understand answers 200, so it is not retried forever.
 */

export const MAX_WEBHOOK_BYTES = 512 * 1024;

export type WebhookSource = "meta" | "hub";

function later(task: () => Promise<unknown>) {
  const run = () => task().catch((caught) => logWarn("webhook.whatsapp.after_failed", { error: caught instanceof Error ? caught.message : "unknown" }));
  try {
    after(run);
  } catch {
    // Outside a request (a test): just run it.
    void run();
  }
}

/** Like `later`, but started now: the request is kept alive until it ends. */
function alongside(task: () => Promise<unknown>) {
  const running = task().catch((caught) => logWarn("webhook.whatsapp.after_failed", { error: caught instanceof Error ? caught.message : "unknown" }));
  try {
    after(running);
  } catch {
    // Outside a request (a test): it is already running.
  }
}

/**
 * `signature` is the request's `x-hub-signature-256`, read by the route so
 * each route says which credential lets it in (tests/public-routes.test.ts).
 */
export async function handleWhatsAppWebhook(
  request: Request,
  check: { secrets: readonly string[]; signature: string | null },
  source: WebhookSource,
): Promise<Response> {
  const { secrets, signature } = check;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });

  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });

  if (!verifySignature(raw, signature, secrets)) {
    logWarn("webhook.whatsapp.unauthorized", { source, reason: "Signature missing or does not match." });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const parsed = parseWebhook(payload);
  if (source === "hub" && parsed.inbound.length > 0) {
    const written = parsed.inbound;
    alongside(async () => (await import("@/modules/whatsapp/data/helper-turn")).runHelperTurns(written));
    if (written.some((message) => isParentFileType(message.type))) {
      // Google trusts this deployment's own identity, carried on the request.
      const identity = await vercelOidcToken(request);
      alongside(async () => (await import("@/modules/whatsapp/data/parent-files")).copyFilesFromWebhook(written, identity));
    }
  }

  let statuses = 0;
  let replies = 0;
  let notForOne = 0;
  let failedWrites = 0;

  for (const status of parsed.statuses) {
    const answer = await recordStatus({
      providerMessageId: status.providerMessageId,
      status: status.status,
      at: status.at,
      errorCode: status.errorCode,
      errorTitle: status.errorTitle,
      detail: { recipient: status.recipient, error_detail: status.errorDetail, via: source },
    }).catch(() => null);
    if (!answer) {
      failedWrites += 1;
      continue;
    }
    if (!answer.matched) {
      // A message from a chat with a parent (D-616) is not on the log: its ticks go onto the chat's line.
      const error = status.status === "failed" ? `meta:${status.errorCode ?? "unknown"}` : null;
      if (await recordChatStatus(status.providerMessageId, status.status, status.at, error).catch(() => false)) statuses += 1;
      continue;
    }
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
    const ours = await isReplyToOne({ from: reply.from, replyTo: reply.replyTo, at: reply.at }).catch(() => null);
    if (ours === null) {
      failedWrites += 1;
      continue;
    }
    if (!ours) {
      notForOne += 1;
      continue;
    }
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

  let templates = 0;
  if (parsed.templates.length > 0) {
    const applied = await applyTemplateEvents(parsed.templates).catch(() => null);
    if (!applied) failedWrites += 1;
    else {
      templates = applied.written;
      if (applied.needsSync) later(() => syncHubTemplates({ staffId: null }, getSiteUrl()));
    }
  }

  if (failedWrites > 0) {
    logWarn("webhook.whatsapp.write_failed", { source, failedWrites });
    return NextResponse.json({ ok: false, error: "Could not write everything; send again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, statuses, replies, notForOne, templates, otherNumber: parsed.otherNumber });
}
