import "server-only";

import { randomBytes } from "node:crypto";

import {
  FEES_APP_REFERENCE_PREFIX,
  isFeesAppReference,
  type FetchedPayment,
} from "@/modules/payments/domain/online/capture-check";
import { verifyCheckoutSignature } from "@/modules/payments/domain/online/checkout-signature";
import { checkFetchedOrderCapture } from "@/modules/payments/domain/online/order-capture-check";
import { readPayPageData, type PayPageData } from "@/modules/payments/domain/online/pay-breakdown";
import { readRazorpayUpiUri } from "@/modules/payments/domain/online/upi-launch";
import { logWarn } from "@/platform/observability/log";

import type { RazorpayClient } from "./razorpay-client";
import type { PaymentOutcome } from "./service";

/**
 * The one-tap pay page's orders: one per tap on Pay, for the total of the
 * parent's per-child lines (`20261029190000`), backed at Razorpay by a checkout
 * Order or by the Order behind a UPI Payment Link (`PayWith`).
 *
 * The money rules live in the database. This file is the IO around them:
 * asking Razorpay to create an order, fetching what was paid on it with the
 * school's key, and handing each verified capture to
 * `online_payment_apply_order_capture`, which posts every child's line or none.
 *
 * Nothing here trusts the browser. The checkout handler's ids and signature
 * only say WHICH payment to fetch; the payment itself is always read from
 * Razorpay, and it must carry an order id we stored.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type OrderRow = {
  id: string;
  public_ref: string;
  status: string;
  send_id: string;
  provider_order_id: string | null;
  provider_receipt?: string | null;
  amount_paise: number;
  created_at: string;
};

const ORDER_COLUMNS = "id, public_ref, status, send_id, provider_order_id, provider_receipt, amount_paise, created_at";

/** The parent page's figures for one send, or null when it is not a usable page. */
export async function readPayPage(supabase: Db, sendId: string): Promise<PayPageData | null> {
  const { data, error } = await supabase.rpc("online_payment_pay_page", { p_send_id: sendId });
  if (error) return null;
  return readPayPageData(data);
}

/**
 * How a tap takes the money.
 *
 *   checkout  a Razorpay Order, paid in Razorpay's checkout on our page. Live
 *             payments need the page's domain approved by Razorpay first.
 *   upi_link  a UPI Payment Link for the same total. A Payment Link lives on
 *             Razorpay's own domain, so it needs no approval, and Razorpay
 *             opens an Order behind it the first time its hosted page is read
 *             (`openLinkOrder` reads it straight away). Every payment on the
 *             link carries that order's id, which is stored as
 *             `provider_order_id`; from there on the order is paid, polled,
 *             reconciled and posted exactly like a checkout one: nothing below
 *             this function knows the difference.
 */
export type PayWith =
  | { kind: "checkout" }
  | { kind: "upi_link"; upiOnly: boolean; callbackUrl: string; description: string };

/** A UPI link order lives two hours: the reconciler's own "abandoned" age. */
const LINK_ORDER_HOURS = 2;

export type OpenedLink = {
  /** Razorpay's hosted page: iPhones, desktops, and Chrome on Android. */
  shortUrl: string | null;
  /** The `upi://` the hosted page redirects Android to, checked; null if unreadable. */
  upiUri: string | null;
  /** References of earlier links this tap replaced, to cancel at Razorpay. */
  replaced: string[];
};

export type OpenCheckoutResult =
  | { kind: "ok"; providerOrderId: string; amountPaise: number; publicRef: string; link?: OpenedLink }
  | { kind: "already_paid"; postedPaymentIds: string[] }
  | { kind: "in_progress" }
  | { kind: "refused"; reason: string; index?: number }
  | { kind: "try_again"; reason: string };

/**
 * A tap on Pay: open an order in the database, then at Razorpay.
 *
 * Before opening a new one, the send's last order is looked at. Money already
 * captured on it is posted and the page told so; a payment still being
 * authorised refuses a second order, so a parent cannot pay twice by tapping
 * twice while their UPI app is still working.
 */
export async function openCheckoutOrder(args: {
  supabase: Db;
  client: RazorpayClient;
  sendId: string;
  lines: Array<{ index: number; amount_rupees: number }>;
  autoPosting: boolean;
  payWith?: PayWith;
}): Promise<OpenCheckoutResult> {
  const { supabase, client } = args;
  const payWith: PayWith = args.payWith ?? { kind: "checkout" };

  const recent = await latestOrder(supabase, args.sendId, 15);
  if (recent && ["paid", "accounted"].includes(recent.status)) return { kind: "already_paid", postedPaymentIds: [] };
  if (recent?.status === "open" && recent.provider_order_id) {
    const payments = await client.fetchOrderPayments(recent.provider_order_id);
    if (payments.kind === "uncertain") return { kind: "try_again", reason: payments.reason };
    if (payments.kind === "ok") {
      const posted: string[] = [];
      for (const payment of payments.value.filter((entry) => entry.status === "captured")) {
        const outcome = await processOrderPayment({ supabase, client, payment, autoPosting: args.autoPosting, actor: "pay_page" });
        if (outcome === "applied" || outcome === "duplicate") posted.push(payment.id);
      }
      if (posted.length > 0) return { kind: "already_paid", postedPaymentIds: posted };
      if (payments.value.some((entry) => entry.status === "created" || entry.status === "authorized")) {
        return { kind: "in_progress" };
      }
    }
  }

  // The links this tap is about to supersede, read before the database marks
  // them: a superseded link must not stay payable at Razorpay.
  const replaced = payWith.kind === "upi_link" ? await openReceipts(supabase, args.sendId) : [];

  const { data, error } = await supabase.rpc("online_payment_open_order", {
    p_send_id: args.sendId,
    p_lines: args.lines,
    p_provider_mode: client.mode,
    p_public_ref: randomBytes(18).toString("base64url"),
  });
  if (error || !data) return { kind: "try_again", reason: "order_unavailable" };
  const opened = data as {
    ok: boolean;
    reason?: string;
    index?: number;
    order?: OpenedOrder;
  };
  if (!opened.ok || !opened.order) return { kind: "refused", reason: opened.reason ?? "refused", index: opened.index };

  const order = opened.order;
  if (payWith.kind === "upi_link") return openLinkOrder({ supabase, client, order, payWith, replaced });

  const created = await client.createOrder({
    amountPaise: Number(order.amount_paise),
    receipt: order.provider_receipt,
    notes: { intent_ref: order.public_ref, purpose: "school_fee" },
  });
  if (created.kind !== "ok") {
    // An order whose id never reached a browser cannot be paid: fail it, and
    // the next tap opens a fresh one. Nothing to look up later.
    await supabase.rpc("online_payment_order_failed", {
      p_order_id: order.id,
      p_error: created.kind === "refused" ? `${created.status} ${created.description}` : created.reason,
    });
    return created.kind === "refused"
      ? { kind: "refused", reason: "provider_refused" }
      : { kind: "try_again", reason: created.reason };
  }

  const { error: recordError } = await supabase.rpc("online_payment_order_recorded", {
    p_order_id: order.id,
    p_provider_order_id: created.value.id,
  });
  if (recordError) {
    await supabase.rpc("online_payment_order_failed", { p_order_id: order.id, p_error: "could not record the provider order" });
    return { kind: "try_again", reason: "record_failed" };
  }
  return { kind: "ok", providerOrderId: created.value.id, amountPaise: Number(order.amount_paise), publicRef: order.public_ref };
}

type OpenedOrder = { id: string; public_ref: string; provider_receipt: string; amount_paise: number };

/**
 * The upi_link half of a tap: a UPI Payment Link for the order's total, whose
 * own Razorpay order becomes ours. The link's reference is the order's
 * `provider_receipt`, so a link whose creation went unanswered can still be
 * found — and cancelled, because nobody holds its address.
 */
async function openLinkOrder(args: {
  supabase: Db;
  client: RazorpayClient;
  order: OpenedOrder;
  payWith: Extract<PayWith, { kind: "upi_link" }>;
  replaced: string[];
}): Promise<OpenCheckoutResult> {
  const { supabase, client, order, payWith } = args;
  const amountPaise = Number(order.amount_paise);
  const fail = async (reason: string) => {
    await supabase.rpc("online_payment_order_failed", { p_order_id: order.id, p_error: reason });
  };

  const created = await client.createPaymentLink({
    amountPaise,
    referenceId: order.provider_receipt,
    expireBy: new Date(Date.now() + LINK_ORDER_HOURS * 3600_000),
    description: payWith.description,
    callbackUrl: payWith.callbackUrl,
    notes: { intent_ref: order.public_ref, purpose: "school_fee" },
    upiOnly: payWith.upiOnly,
  });
  if (created.kind !== "ok") {
    if (created.kind === "uncertain") await cancelLinksByReference(client, [order.provider_receipt]);
    await fail(created.kind === "refused" ? `${created.status} ${created.description}` : created.reason);
    return created.kind === "refused" ? { kind: "refused", reason: "provider_refused" } : { kind: "try_again", reason: created.reason };
  }

  const link = created.value;
  // Razorpay opens the Order behind a link when its hosted page is first READ,
  // not when the link is created: probed live on 2026-10-30, a new link had no
  // `order_id` after the create or a fetch, and had one the instant its page
  // had been read. The first one-tap pilot taps all failed on exactly that. So
  // the page is read first — it is also where the `upi://` comes from — and
  // the link fetched after; a slow first read gets one more try.
  const linkOrderId = async () => {
    const fetched = await client.fetchPaymentLink(link.id);
    return fetched.kind === "ok" ? (fetched.value?.order_id ?? null) : null;
  };
  let location = await client.fetchUpiIntentUri(link.id);
  let providerOrderId = link.order_id ?? (await linkOrderId());
  if (!providerOrderId || (payWith.upiOnly && !location)) {
    location = (await client.fetchUpiIntentUri(link.id)) ?? location;
    providerOrderId = providerOrderId ?? (await linkOrderId());
  }
  const { error: recordError } = providerOrderId
    ? await supabase.rpc("online_payment_order_recorded", { p_order_id: order.id, p_provider_order_id: providerOrderId })
    : { error: true };
  if (!providerOrderId || recordError) {
    // A link we could not tie to the order is a link we could not post from.
    await client.cancelPaymentLink(link.id);
    await fail(providerOrderId ? "could not record the provider order" : "payment link has no order");
    return { kind: "try_again", reason: providerOrderId ? "record_failed" : "link_without_order" };
  }

  const upiUri = payWith.upiOnly ? readRazorpayUpiUri(location, amountPaise) : null;
  return {
    kind: "ok",
    providerOrderId,
    amountPaise,
    publicRef: order.public_ref,
    link: { shortUrl: link.short_url ?? null, upiUri, replaced: args.replaced },
  };
}

/** The send's orders that could still take money, by the reference their link carries. */
async function openReceipts(supabase: Db, sendId: string): Promise<string[]> {
  const { data } = await supabase
    .from("online_payment_orders")
    .select("provider_receipt")
    .eq("send_id", sendId)
    .in("status", ["pending", "open"])
    .gte("created_at", new Date(Date.now() - LINK_ORDER_HOURS * 3600_000).toISOString())
    .limit(10);
  return ((data ?? []) as Array<{ provider_receipt?: string | null }>)
    .map((row) => row.provider_receipt ?? "")
    .filter(Boolean);
}

/**
 * Cancel the links behind these references, where they are still unpaid. A
 * checkout order has no link and is skipped by the lookup. Best effort: a link
 * that stays payable is still harmless, because money on a superseded order is
 * posted if it still fits and sent to review if not.
 */
export async function cancelLinksByReference(client: RazorpayClient, references: string[]): Promise<void> {
  for (const reference of references) {
    const found = await client.fetchPaymentLinkByReference(reference);
    if (found.kind === "ok" && found.value && found.value.status === "created") {
      await client.cancelPaymentLink(found.value.id);
    }
  }
}

/**
 * A fetched payment that carries one of OUR order ids: record it and, with
 * automatic posting on, post it. Null when the payment is not on an order of
 * ours, so the caller carries on down the Payment Link path.
 */
export async function processOrderPayment(args: {
  supabase: Db;
  client: RazorpayClient;
  payment: FetchedPayment;
  autoPosting: boolean;
  actor?: string;
}): Promise<PaymentOutcome | null> {
  const { supabase, client, payment } = args;
  const providerOrderId = payment.order_id;
  if (!providerOrderId) return null;
  const { data: order, error } = await supabase
    .from("online_payment_orders")
    .select("id, provider_receipt")
    .eq("provider_order_id", providerOrderId)
    .maybeSingle();
  if (error) return "retry";
  if (!order) return null;
  // One only (critique0 #2): an order the fees app opened is in this database
  // only because it was imported. The fees app posts its money in its own
  // ledger and tail-sync brings the receipt; posting it here too would be a
  // second receipt for one payment. The database refuses it as well
  // (fee-migration 20261031120000).
  if (isFeesAppReference((order as { provider_receipt?: string | null }).provider_receipt)) {
    logWarn("online.order_payment.fees_app_order", { paymentId: payment.id });
    return "not_ours";
  }

  const checked = checkFetchedOrderCapture({ payment, providerOrderId, mode: client.mode });
  if (!checked.ok) {
    if (checked.reason === "not_captured") return "waiting_for_capture";
    logWarn("online.order_payment.refused", { paymentId: payment.id, reason: checked.reason });
    return "not_ours";
  }

  const { data, error: recordError } = await supabase.rpc("online_payment_record_order_capture", { p_facts: checked.facts });
  if (recordError || !data) return "retry";
  const recorded = data as { recorded: boolean; reason?: string; capture?: { id: string; application_status: string } };
  // One only: the database's own refusal of a fees app order (20261031120000).
  if (recorded.reason === "not_ours") return "not_ours";
  if (!recorded.recorded || !recorded.capture) return "waiting_for_capture";
  if (recorded.capture.application_status === "applied") return "duplicate";
  if (recorded.capture.application_status === "review_required") return "review_required";
  if (!args.autoPosting) return "recorded";
  return applyOrderCapture(supabase, recorded.capture.id, args.actor ?? "system");
}

export async function applyOrderCapture(supabase: Db, captureId: string, actor: string): Promise<PaymentOutcome> {
  // One only: never post a capture on a fees app order (critique0 #2). The
  // database function refuses it too; this says so without asking it.
  const { data: target, error: targetError } = await supabase
    .from("online_payment_captures")
    .select("online_payment_orders(provider_receipt)")
    .eq("id", captureId)
    .maybeSingle();
  if (targetError) return "retry";
  const order = (target as { online_payment_orders?: { provider_receipt?: string | null } | null } | null)?.online_payment_orders;
  if (isFeesAppReference(order?.provider_receipt)) return "not_ours";
  const { data, error } = await supabase.rpc("online_payment_apply_order_capture", {
    p_capture_id: captureId,
    p_actor: actor,
  });
  if (error || !data) return "retry";
  const applied = data as { applied: boolean; duplicate?: boolean; status?: string };
  if (applied.applied) return applied.duplicate ? "duplicate" : "applied";
  if (applied.status === "not_ours") return "not_ours";
  return applied.status === "review_required" ? "review_required" : "recorded";
}

export type CheckoutStatus =
  | { state: "none" }
  | { state: "waiting" }
  | { state: "confirming" }
  /** Razorpay says every attempt on the order failed and nothing was taken: offer a clean retry. */
  | { state: "failed" }
  | { state: "received"; receipts: Array<{ receiptNumber: string; amount: number }> };

/**
 * The checkout handler fired: look at THAT payment now, with the school's key.
 * The signature is checked and logged when wrong, but decides nothing.
 */
export async function confirmCheckout(args: {
  supabase: Db;
  client: RazorpayClient;
  sendId: string;
  providerOrderId: string;
  paymentId: string;
  signature: string | null;
  keySecret: string;
  autoPosting: boolean;
}): Promise<{ status: CheckoutStatus; postedPaymentIds: string[] }> {
  const { supabase, client } = args;
  const { data: order } = await supabase
    .from("online_payment_orders")
    .select(ORDER_COLUMNS)
    .eq("provider_order_id", args.providerOrderId)
    .eq("send_id", args.sendId)
    .maybeSingle();
  if (!order) return { status: { state: "none" }, postedPaymentIds: [] };

  if (!verifyCheckoutSignature({ orderId: args.providerOrderId, paymentId: args.paymentId, signature: args.signature, keySecret: args.keySecret })) {
    logWarn("online.checkout.bad_signature", { orderId: args.providerOrderId });
  }

  const posted: string[] = [];
  if (/^pay_[A-Za-z0-9]+$/.test(args.paymentId)) {
    const payment = await client.fetchPayment(args.paymentId);
    if (payment.kind === "ok" && payment.value.order_id === args.providerOrderId) {
      const outcome = await processOrderPayment({ supabase, client, payment: payment.value, autoPosting: args.autoPosting, actor: "pay_page" });
      if (outcome === "applied" || outcome === "duplicate") posted.push(payment.value.id);
    }
  }
  return { status: await orderStatus(supabase, order.id), postedPaymentIds: posted };
}

/**
 * What the page shows while it waits, and the poll that keeps it honest when
 * the checkout handler never fires (a browser killed on the way to the UPI
 * app). Asks Razorpay at most once every eight seconds per order.
 */
export async function refreshOrderStatus(args: {
  supabase: Db;
  client: RazorpayClient;
  sendId: string;
  autoPosting: boolean;
}): Promise<{ status: CheckoutStatus; postedPaymentIds: string[] }> {
  const { supabase, client } = args;
  const order = await latestOrder(supabase, args.sendId, 30);
  if (!order) return { status: { state: "none" }, postedPaymentIds: [] };

  const posted: string[] = [];
  if (["open", "paid"].includes(order.status) && order.provider_order_id) {
    const { data: claimed } = await supabase
      .from("online_payment_orders")
      .update({ last_reconciled_at: new Date().toISOString() })
      .eq("id", order.id)
      .or(`last_reconciled_at.is.null,last_reconciled_at.lt.${new Date(Date.now() - 8_000).toISOString()}`)
      .select("id");
    if ((claimed ?? []).length > 0) {
      const payments = await client.fetchOrderPayments(order.provider_order_id);
      if (payments.kind === "ok") {
        for (const payment of payments.value.filter((entry) => entry.status === "captured")) {
          const outcome = await processOrderPayment({ supabase, client, payment, autoPosting: args.autoPosting, actor: "pay_page" });
          if (outcome === "applied" || outcome === "duplicate") posted.push(payment.id);
        }
        if (posted.length === 0 && payments.value.some((entry) => entry.status === "authorized")) {
          return { status: { state: "confirming" }, postedPaymentIds: [] };
        }
        // Declined or cancelled in the UPI app: no money moved. The order stays
        // open — a late success on it is still found and posted — but the page
        // stops waiting and offers the parent another try.
        if (posted.length === 0 && payments.value.length > 0 && payments.value.every((entry) => entry.status === "failed")) {
          return { status: { state: "failed" }, postedPaymentIds: [] };
        }
      }
    }
  }
  return { status: await orderStatus(supabase, order.id), postedPaymentIds: posted };
}

/** The page's opening state, from the database only: opening the page never calls Razorpay. */
export async function readCheckoutStatus(supabase: Db, sendId: string): Promise<CheckoutStatus> {
  const order = await latestOrder(supabase, sendId, 30);
  return order ? orderStatus(supabase, order.id) : { state: "none" };
}

async function latestOrder(supabase: Db, sendId: string, withinMinutes: number): Promise<OrderRow | null> {
  const { data } = await supabase
    .from("online_payment_orders")
    .select(ORDER_COLUMNS)
    .eq("send_id", sendId)
    .in("status", ["open", "paid", "accounted", "review_required"])
    .gte("created_at", new Date(Date.now() - withinMinutes * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as OrderRow | null) ?? null;
}

async function orderStatus(supabase: Db, orderId: string): Promise<CheckoutStatus> {
  const { data: order } = await supabase.from("online_payment_orders").select("status").eq("id", orderId).maybeSingle();
  const status = (order as { status?: string } | null)?.status;
  if (status === "accounted") {
    const { data: lines } = await supabase
      .from("online_payment_order_lines")
      .select("line_no, receipts(receipt_number, total_amount)")
      .eq("order_id", orderId)
      .order("line_no", { ascending: true });
    const receipts = ((lines ?? []) as Array<{ receipts: { receipt_number?: string; total_amount?: number } | null }>)
      .map((line) => line.receipts)
      .filter((receipt): receipt is { receipt_number: string; total_amount: number } => Boolean(receipt?.receipt_number))
      .map((receipt) => ({ receiptNumber: receipt.receipt_number, amount: Number(receipt.total_amount) }));
    return { state: "received", receipts };
  }
  if (status === "paid" || status === "review_required") return { state: "confirming" };
  if (status === "open") return { state: "waiting" };
  return { state: "none" };
}

/**
 * The reconciler's pass over orders: every recent order that could still take
 * money is asked about, so a payment the webhook never delivered is found.
 *
 *   pending > 10 min, never recorded at Razorpay   → failed (no browser held it)
 *   open / superseded / paid, under 24 h           → payments fetched, captured ones posted
 *   open > 2 h with nothing captured               → abandoned (still recorded if money lands)
 */
export async function reconcileOpenOrders(args: {
  supabase: Db;
  client: RazorpayClient;
  autoPosting: boolean;
  now?: () => number;
  outOfTime?: () => boolean;
}): Promise<{ checked: number; posted: string[] }> {
  const { supabase, client } = args;
  const now = args.now ?? Date.now;
  const posted: string[] = [];

  // One only (critique0 #2): the fees app's orders (`vpps_o_…`) are never
  // failed, asked about or posted from here — filtered in the query, so they
  // cannot fill the thirty-a-pass window, and again per row. `vpps_%` is a
  // LIKE pattern: "vpps", any one character, anything; One's `vp1_o_…` never
  // matches it.
  const { data: stuck } = await supabase
    .from("online_payment_orders")
    .select("id, provider_receipt")
    .eq("status", "pending")
    .lt("created_at", new Date(now() - 10 * 60_000).toISOString())
    .not("provider_receipt", "like", `${FEES_APP_REFERENCE_PREFIX}%`)
    .limit(25);
  for (const order of (stuck ?? []) as Array<{ id: string; provider_receipt?: string | null }>) {
    if (isFeesAppReference(order.provider_receipt)) continue;
    await supabase.rpc("online_payment_order_failed", { p_order_id: order.id, p_error: "never recorded at Razorpay" });
  }

  const { data: orders } = await supabase
    .from("online_payment_orders")
    .select(ORDER_COLUMNS)
    .in("status", ["open", "superseded", "paid"])
    .gte("created_at", new Date(now() - 24 * 3600_000).toISOString())
    .not("provider_receipt", "like", `${FEES_APP_REFERENCE_PREFIX}%`)
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(30);

  let checked = 0;
  for (const order of (orders ?? []) as OrderRow[]) {
    if (args.outOfTime?.()) break;
    if (!order.provider_order_id) continue;
    if (isFeesAppReference(order.provider_receipt)) continue;
    checked += 1;
    await supabase.from("online_payment_orders").update({ last_reconciled_at: new Date(now()).toISOString() }).eq("id", order.id);
    const payments = await client.fetchOrderPayments(order.provider_order_id);
    if (payments.kind !== "ok") continue;
    for (const payment of payments.value.filter((entry) => entry.status === "captured")) {
      const outcome = await processOrderPayment({ supabase, client, payment, autoPosting: args.autoPosting, actor: "reconciler" });
      if (outcome === "applied") posted.push(payment.id);
    }
    const capturedAny = payments.value.some((entry) => entry.status === "captured");
    const ageMs = now() - new Date(order.created_at).getTime();
    if (order.status === "open" && !capturedAny && ageMs > 2 * 3600_000) {
      await supabase.rpc("online_payment_order_closed", { p_order_id: order.id, p_status: "abandoned" });
    }
  }
  return { checked, posted };
}
