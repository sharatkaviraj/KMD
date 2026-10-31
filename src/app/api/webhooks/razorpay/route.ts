import { createHash } from "node:crypto";

import { after, NextResponse } from "next/server";

import { afterOnlinePosting } from "@/modules/payments/data/online/after-posting";
import { createRazorpayClient, readRazorpayConfig } from "@/modules/payments/data/online/razorpay-client";
import { processInboxEventById } from "@/modules/payments/data/online/service";
import { HANDLED_EVENTS, readRazorpayEvent } from "@/modules/payments/domain/online/razorpay-events";
import { verifyRazorpaySignature } from "@/modules/payments/domain/online/razorpay-signature";
import { logError, logWarn } from "@/platform/observability/log";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

/**
 * Razorpay webhook intake.
 *
 * **A 404 until `RAZORPAY_WEBHOOK_SECRET` is set**, the same rule as the
 * AiSensy hook: until then this is not a route.
 *
 * The job here is small on purpose. Razorpay wants a 2xx within five seconds
 * and retries for a day otherwise, so this verifies the signature over the raw
 * bytes, writes the event to the inbox (`online_payment_events`, unique on the
 * event id), answers, and only THEN — in `after()` — asks Razorpay about the
 * payment. If that hand-off dies, the ten-minute reconciler finishes it.
 *
 * The body is never trusted for money. It names a payment id; the processor
 * fetches that payment with the school's API key and decides from Razorpay's
 * answer. A redirect, a screenshot or a transaction number typed by a parent
 * cannot reach this path at all.
 *
 * A duplicate delivery is a 200 with nothing done. A database failure is a
 * 500, so Razorpay delivers it again.
 *
 * One (go-live Phase E): public in the middleware (`/api/webhooks`), so a
 * delivery is never a 307 to the login page. Razorpay sends every event on the
 * school's account to both apps' webhooks; a fees app (`vpps_`) payment is
 * written to the inbox and marked ignored — never recorded or posted here
 * (`processOrderPayment`, `checkFetchedCapture`, and the database itself).
 */

/**
 * The `after()` work runs on this function's clock: posting, the matview
 * drain and the WhatsApp receipt (a PDF render and an AiSensy call).
 */
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024;
const NOT_HERE = () => NextResponse.json({ error: "Not found" }, { status: 404 });

function webhookSecret(): string | null {
  return process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null;
}

export async function POST(request: Request) {
  const secret = webhookSecret();
  if (!secret) return NOT_HERE();

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  }

  if (!verifyRazorpaySignature(raw, request.headers.get("x-razorpay-signature"), secret)) {
    // Logged without the body or the header: neither belongs in a log.
    logWarn("webhook.razorpay.bad_signature", { bytes: raw.length });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: "not_json" });
  }
  const facts = readRazorpayEvent(body);
  const eventId = request.headers.get("x-razorpay-event-id")?.trim() ?? "";
  if (!facts || !/^[A-Za-z0-9_-]{6,64}$/.test(eventId)) {
    // Signed by Razorpay but not an event we can key: accepted, so it is not
    // retried for a day, and ignored.
    return NextResponse.json({ ok: true, ignored: "not_an_event" });
  }
  if (!HANDLED_EVENTS.has(facts.eventType)) {
    // An event the dashboard sends that this app does not act on. Acknowledged
    // and not stored, so the inbox holds only what someone will look at.
    return NextResponse.json({ ok: true, ignored: "unhandled_event" });
  }

  // One account only. When the merchant id is configured, an event signed for
  // anything else is recorded nowhere.
  const expectedAccount = process.env.RAZORPAY_ACCOUNT_ID?.trim();
  if (expectedAccount && facts.accountId && facts.accountId !== expectedAccount) {
    logWarn("webhook.razorpay.other_account", { eventType: facts.eventType });
    return NextResponse.json({ ok: true, ignored: "other_account" });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("online_payment_record_event", {
    p_provider_event_id: eventId,
    p_event_type: facts.eventType,
    p_account_id: facts.accountId,
    p_provider_payment_id: facts.paymentId,
    p_provider_link_id: facts.paymentLinkId,
    p_payload_sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    p_facts: facts.facts,
  });
  if (error || !data) {
    logError("webhook.razorpay.inbox_write_failed", { eventType: facts.eventType });
    return NextResponse.json({ error: "Not recorded" }, { status: 500 });
  }

  const recorded = data as { id: string; duplicate: boolean };
  const config = readRazorpayConfig();
  if (!recorded.duplicate && config) {
    after(async () => {
      try {
        const supabase = createAdminClient();
        const outcome = await processInboxEventById({
          supabase,
          client: createRazorpayClient(config),
          eventId: recorded.id,
        });
        // Posted (or posted a moment ago by a sibling event for the same
        // payment): refresh the views, caches and staff tabs, and send the
        // WhatsApp receipt NOW rather than at the next ten-minute pass.
        if ((outcome === "applied" || outcome === "duplicate") && facts.paymentId) {
          await afterOnlinePosting({ supabase, paymentIds: [facts.paymentId] });
        }
      } catch (caught) {
        logError("webhook.razorpay.process_failed", {
          eventType: facts.eventType,
          error: caught instanceof Error ? caught.message : "unknown",
        });
      }
    });
  }

  return NextResponse.json({ ok: true, duplicate: recorded.duplicate });
}

/** Same rule as POST: without the secret this route does not exist. */
export async function GET() {
  return webhookSecret() ? NextResponse.json({ ok: true, configured: true }) : NOT_HERE();
}
