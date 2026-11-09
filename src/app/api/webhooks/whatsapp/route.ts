import { NextResponse } from "next/server";

import { handleWhatsAppWebhook } from "@/modules/whatsapp/data/whatsapp-webhook";
import { webhookSecrets, webhookVerifyToken } from "@/platform/whatsapp/config";

/**
 * Meta's own WhatsApp webhook (D-562), for a deployment that talks to Meta's
 * Cloud API directly. One normally goes through the school's hub, whose
 * webhook is `/api/webhooks/whatsapp-hub`.
 *
 * **A 404 until `WHATSAPP_APP_SECRET` is set**, the same rule as the Razorpay
 * hook: until then this is not a route. Every POST must carry
 * `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the exact bytes
 * received; anything else is a 401 and nothing is read. What it writes:
 * `modules/whatsapp/data/whatsapp-webhook.ts`.
 *
 * GET is Meta's one-time handshake: it echoes `hub.challenge` when
 * `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return handleWhatsAppWebhook(request, { secrets, signature: request.headers.get("x-hub-signature-256") }, "meta");
}
