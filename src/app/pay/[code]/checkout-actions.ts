"use server";

import { headers } from "next/headers";
import { after } from "next/server";

import { afterOnlinePosting } from "@/modules/payments/data/online/after-posting";
import {
  cancelLinksByReference,
  confirmCheckout,
  openCheckoutOrder,
  type CheckoutStatus,
  type PayWith,
} from "@/modules/payments/data/online/orders";
import { createRazorpayClient, readRazorpayConfig } from "@/modules/payments/data/online/razorpay-client";
import { readCheckoutOptions, readOnlineSwitches, readUpiOnlyLinks } from "@/modules/payments/data/online/service";
import { CHECKOUT_MAX_CHILDREN, checkoutAudienceAllows } from "@/modules/payments/domain/online/pay-scope";
import { schoolProfile } from "@/platform/config/school";
import { createAbsoluteUrl, getSiteUrl } from "@/platform/env";
import { logWarn } from "@/platform/observability/log";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

import { loadCheckoutSend } from "./checkout-send";
import { originFromHeaders } from "./request-origin";

/**
 * The one-tap pay page's two writes. Public by design, like the page: the
 * caller is a parent with no account. Each takes the pay code from the URL and
 * re-derives the send, its children and every bound from the database; the
 * browser supplies only "index i, ₹n" per child — never a student id — and,
 * after checkout, which payment to look at.
 */

export type StartCheckoutResult =
  | { kind: "ok"; keyId: string; orderId: string; amountPaise: number; contact: string | null }
  | { kind: "upi"; amountPaise: number; upiUri: string | null; shortUrl: string | null }
  | { kind: "already_paid" }
  | { kind: "in_progress" }
  | { kind: "refused"; reason: string; index?: number }
  | { kind: "try_again" }
  | { kind: "unavailable" };

function cleanLines(value: unknown): Array<{ index: number; amount_rupees: number }> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > CHECKOUT_MAX_CHILDREN) return null;
  const lines: Array<{ index: number; amount_rupees: number }> = [];
  for (const entry of value) {
    const index = Number((entry as { index?: unknown })?.index);
    const amount = Number((entry as { amount_rupees?: unknown })?.amount_rupees);
    if (!Number.isInteger(index) || index < 0 || index >= CHECKOUT_MAX_CHILDREN) return null;
    if (!Number.isSafeInteger(amount) || amount <= 0) return null;
    lines.push({ index, amount_rupees: amount });
  }
  return lines;
}

export async function startCheckoutAction(code: string, lines: unknown): Promise<StartCheckoutResult> {
  const send = await loadCheckoutSend(code);
  const config = readRazorpayConfig();
  const clean = cleanLines(lines);
  if (!send || !config) return { kind: "unavailable" };
  if (!clean) return { kind: "refused", reason: "bad_line" };

  const supabase = createAdminClient();
  const [switches, options] = await Promise.all([readOnlineSwitches(supabase), readCheckoutOptions(supabase)]);
  // The pilot: the page is not offered outside it, and neither is a new order.
  if (!checkoutAudienceAllows(send.sessionLabel, options.allSessions)) return { kind: "unavailable" };

  let payWith: PayWith = { kind: "checkout" };
  if (!options.razorpayCheckout) {
    // Where Razorpay's hosted page returns an iPhone or desktop. From the
    // request's host: the env-based default resolves to localhost in production.
    const origin = originFromHeaders(await headers()) ?? getSiteUrl();
    payWith = {
      kind: "upi_link",
      // Razorpay offers UPI Payment Links in Live mode only.
      upiOnly: config.mode === "live" && (await readUpiOnlyLinks(supabase)),
      // Back to this page, which picks the order up and polls it. Already
      // shape-checked by `loadCheckoutSend`.
      callbackUrl: createAbsoluteUrl(`/pay/${encodeURIComponent(decodeURIComponent(String(code)).trim())}`, origin),
      description: `${schoolProfile.name} — school fees`,
    };
  }

  const client = createRazorpayClient(config);
  const result = await openCheckoutOrder({
    supabase,
    client,
    sendId: send.id,
    lines: clean,
    autoPosting: switches.autoPosting,
    payWith,
  });

  if (result.kind === "ok") {
    if (result.link) {
      const { replaced } = result.link;
      if (replaced.length > 0) after(() => cancelLinksByReference(client, replaced));
      return { kind: "upi", amountPaise: result.amountPaise, upiUri: result.link.upiUri, shortUrl: result.link.shortUrl };
    }
    return { kind: "ok", keyId: config.keyId, orderId: result.providerOrderId, amountPaise: result.amountPaise, contact: send.contact };
  }
  if (result.kind === "already_paid") {
    if (result.postedPaymentIds.length > 0) {
      after(() => afterOnlinePosting({ supabase: createAdminClient(), paymentIds: result.postedPaymentIds }));
    }
    return { kind: "already_paid" };
  }
  if (result.kind === "in_progress") return { kind: "in_progress" };
  if (result.kind === "refused") {
    if (result.reason === "switched_off") return { kind: "unavailable" };
    return { kind: "refused", reason: result.reason, index: result.index };
  }
  logWarn("pay.checkout.try_again", { reason: result.reason });
  return { kind: "try_again" };
}

export async function confirmCheckoutAction(
  code: string,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<CheckoutStatus> {
  const send = await loadCheckoutSend(code);
  const config = readRazorpayConfig();
  if (!send || !config) return { state: "none" };
  const supabase = createAdminClient();
  const switches = await readOnlineSwitches(supabase);
  const { status, postedPaymentIds } = await confirmCheckout({
    supabase,
    client: createRazorpayClient(config),
    sendId: send.id,
    providerOrderId: String(orderId ?? ""),
    paymentId: String(paymentId ?? ""),
    signature: typeof signature === "string" ? signature : null,
    keySecret: config.keySecret,
    autoPosting: switches.autoPosting,
  });
  // Posted from here: views, caches, staff tabs and the receipt, after the reply.
  if (postedPaymentIds.length > 0) {
    after(() => afterOnlinePosting({ supabase: createAdminClient(), paymentIds: postedPaymentIds }));
  }
  return status;
}
