import { NextResponse } from "next/server";

import { handleWhatsAppWebhook } from "@/modules/whatsapp/data/whatsapp-webhook";
import { hubWebhookSecrets } from "@/platform/whatsapp/config";

/**
 * The school's WhatsApp hub's webhook (D-566): every event for
 * +91 83022 07823, forwarded by the hub to the app URLs in its
 * `APP_WEBHOOKS`, One's being `one:https://one.vpps.co.in/api/webhooks/whatsapp-hub`.
 *
 * The body is Meta's webhook JSON, unchanged: delivery statuses, parents'
 * replies, and template approvals and category changes. It is signed
 * `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`, keyed with
 * One's own hub key, `WHATSAPP_HUB_KEY` (the hub's API doc, 9 Nov 2026).
 * `X-Vpps-Hub-App` names the app; the signature, not that header, is what
 * lets anything in.
 *
 * **A 404 until `WHATSAPP_HUB_KEY` is set.** Anything not signed with it is a
 * 401 and nothing is read. Delivery is best-effort and can repeat or arrive
 * out of order; the log keeps one row per message id and never moves a status
 * backwards, and the queue job also asks the hub (`GET /v1/status/{wamid}`)
 * about anything it has not heard back on. What it writes:
 * `modules/whatsapp/data/whatsapp-webhook.ts`.
 *
 * A parent's message may also be answered by Veer Patta AI (D-574). That
 * starts at once, beside the rest, and the hub gets its answer without waiting
 * for it; the request stays alive until the reply is sent. Claiming the
 * message, asking Claude and sending the reply can take half a minute, hence
 * the longer limit.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secrets = hubWebhookSecrets();
  if (secrets.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handleWhatsAppWebhook(request, { secrets, signature: request.headers.get("x-hub-signature-256") }, "hub");
}
