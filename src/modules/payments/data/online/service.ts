import "server-only";

import { randomBytes } from "node:crypto";

import {
  FEES_APP_REFERENCE_PREFIX,
  checkFetchedCapture,
  isFeesAppReference,
  paymentIntentRef,
} from "@/modules/payments/domain/online/capture-check";
import { readRazorpayEvent } from "@/modules/payments/domain/online/razorpay-events";
import { isOnlineSituation, type PayScope } from "@/modules/payments/domain/online/pay-scope";
import {
  isDuplicateReference,
  readRazorpayConfig,
  type RazorpayClient,
} from "@/modules/payments/data/online/razorpay-client";
import { logWarn } from "@/platform/observability/log";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

import { applyOrderCapture, processOrderPayment, reconcileOpenOrders } from "./orders";

/**
 * Online payments: the IO around the database functions in
 * `20261028140100_online_payments.sql`.
 *
 * The rules that decide money live in Postgres — the quote, the one-open-intent
 * index, the amount and mode checks, the posting itself. This file fetches from
 * Razorpay, hands the database what Razorpay said, and never decides on its own
 * that anything is paid.
 *
 * `supabase` is always the SERVICE-ROLE client: every function called here is
 * granted to service_role only.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type OnlineSwitches = { links: boolean; autoPosting: boolean; receipts: boolean };

const SWITCH_KEYS = {
  links: "online_payment_links_enabled",
  autoPosting: "online_payment_auto_posting_enabled",
  receipts: "online_payment_receipts_enabled",
} as const;

/** Any read failure reads as OFF. */
export async function readOnlineSwitches(supabase: Db): Promise<OnlineSwitches> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", Object.values(SWITCH_KEYS));
    if (error) throw error;
    const on = new Set(
      ((data ?? []) as Array<{ key: string; value: string }>)
        .filter((row) => String(row.value).toLowerCase() === "true")
        .map((row) => row.key),
    );
    return {
      links: on.has(SWITCH_KEYS.links),
      autoPosting: on.has(SWITCH_KEYS.autoPosting),
      receipts: on.has(SWITCH_KEYS.receipts),
    };
  } catch {
    return { links: false, autoPosting: false, receipts: false };
  }
}

const UPI_ONLY_KEY = "online_payment_upi_only";

/**
 * Whether new links are UPI Payment Links. On unless `online_payment_upi_only`
 * reads 'false': the standard link made every payer type a phone number and
 * pick a method before reaching UPI, which is how almost every parent pays.
 * Setting it to 'false' brings back the standard link, with cards and
 * netbanking, without a deploy. Razorpay offers UPI links in Live mode only,
 * so the caller still sends a test key a standard link.
 */
export async function readUpiOnlyLinks(supabase: Db): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", UPI_ONLY_KEY)
      .maybeSingle();
    if (error) throw error;
    return String((data as { value?: string } | null)?.value ?? "true").toLowerCase() !== "false";
  } catch {
    return true;
  }
}

export type CheckoutOptions = { razorpayCheckout: boolean; allSessions: boolean; waiveLateFees: boolean };

const CHECKOUT_OPTION_KEYS = {
  razorpayCheckout: "online_payment_checkout_modal_enabled",
  allSessions: "online_payment_checkout_all_sessions",
  waiveLateFees: "online_payment_waive_late_fees",
} as const;

/**
 * How the one-tap page takes the money, and who sees it. Both OFF unless set
 * to 'true', and any read failure reads as OFF:
 *
 *   razorpayCheckout  off → each tap opens a UPI Payment Link and the page
 *                     shows UPI app buttons; on → Razorpay's checkout on our
 *                     page. Checkout only works once Razorpay has approved the
 *                     site's domain, a Payment Link lives on Razorpay's own.
 *   allSessions       off → test sessions only, the pilot; on → every family.
 *   waiveLateFees     on → this year a payment online forgives the child's late
 *                     fees, so the page never shows one and asks for fees
 *                     only (20261030120000, owner's decision 2026-10-30).
 */
export async function readCheckoutOptions(supabase: Db): Promise<CheckoutOptions> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", Object.values(CHECKOUT_OPTION_KEYS));
    if (error) throw error;
    const on = new Set(
      ((data ?? []) as Array<{ key: string; value: string }>)
        .filter((row) => String(row.value).toLowerCase() === "true")
        .map((row) => row.key),
    );
    return {
      razorpayCheckout: on.has(CHECKOUT_OPTION_KEYS.razorpayCheckout),
      allSessions: on.has(CHECKOUT_OPTION_KEYS.allSessions),
      waiveLateFees: on.has(CHECKOUT_OPTION_KEYS.waiveLateFees),
    };
  } catch {
    return { razorpayCheckout: false, allSessions: false, waiveLateFees: false };
  }
}

export type Quote = {
  version: number;
  total: number;
  fees_total: number;
  late_fee_total: number;
  eligible: boolean;
  reasons: string[];
  hash: string;
  lines: Array<{ installment_no: number; carry_forward: boolean; total_pending: number }>;
};

export async function quoteScope(
  supabase: Db,
  studentId: string,
  scope: Pick<PayScope, "installments" | "lastYear">,
): Promise<Quote | null> {
  const { data, error } = await supabase.rpc("online_payment_quote_for", {
    p_student_id: studentId,
    p_installment_nos: scope.installments,
    p_include_carry_forward: scope.lastYear,
  });
  if (error || !data) return null;
  return data as Quote;
}

/**
 * The reminder sender's last look at the ledger, when online payments are on.
 *
 * Undefined — no recheck, the sender exactly as before — without Razorpay keys
 * or with the links switch off. Built by the APP layer and handed to
 * `executeReminderRun`, so the WhatsApp module does not import this one.
 */
export async function onlineLedgerRecheck(): Promise<
  | ((scope: { studentId: string; installments: number[]; lastYear: boolean; situation: string }) => Promise<
      { total: number; eligible: boolean; reasons: string[] } | null | "not_applicable"
    >)
  | undefined
> {
  if (!readRazorpayConfig()) return undefined;
  const supabase = createAdminClient();
  const switches = await readOnlineSwitches(supabase);
  if (!switches.links) return undefined;
  return async (scope) => {
    if (!isOnlineSituation(scope.situation)) return "not_applicable";
    const quote = await quoteScope(supabase, scope.studentId, scope);
    return quote ? { total: quote.total, eligible: quote.eligible, reasons: quote.reasons } : null;
  };
}

export type IntentRow = {
  id: string;
  public_ref: string;
  status: string;
  student_id: string;
  amount_rupees: number;
  amount_paise: number;
  expires_at: string;
  provider_mode: "test" | "live";
  provider_reference_id: string;
  provider_link_id: string | null;
  provider_short_url: string | null;
  link_attempts: number;
  receipt_id: string | null;
};

/**
 * When a link stops taking money: the end of the notice's own date in IST, or
 * a week out for a notice that prints none — and never inside Razorpay's
 * 15-minute floor.
 */
export function linkExpiry(noticeDateIso: string | null, now: Date = new Date()): Date {
  const floor = new Date(now.getTime() + 20 * 60 * 1000);
  const fallback = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  if (!noticeDateIso || !/^\d{4}-\d{2}-\d{2}$/.test(noticeDateIso)) return fallback;
  const endOfDayIst = new Date(`${noticeDateIso}T23:59:00+05:30`);
  if (Number.isNaN(endOfDayIst.getTime())) return fallback;
  return endOfDayIst < floor ? floor : endOfDayIst;
}

export type StartResult =
  | { kind: "redirect"; url: string; intentId: string }
  | { kind: "unavailable"; reason: string; reasons?: string[] }
  | { kind: "try_again"; reason: string };

/**
 * Open (or reuse) the intent for one student's scope and hand back a link to
 * pay it. Two phones tapping at once land on the same intent — the database's
 * one-open-intent index and the student lock decide it — and then on the same
 * provider link, because the link is found by the intent's own reference.
 */
export async function startOnlinePayment(args: {
  supabase: Db;
  client: RazorpayClient;
  studentId: string;
  sendId: string | null;
  scope: Pick<PayScope, "installments" | "lastYear">;
  noticeDateIso: string | null;
  callbackUrl: string;
  schoolName: string;
  now?: Date;
}): Promise<StartResult> {
  const { supabase, client } = args;
  const { data, error } = await supabase.rpc("online_payment_open_intent", {
    p_student_id: args.studentId,
    p_send_id: args.sendId,
    p_installment_nos: args.scope.installments,
    p_include_carry_forward: args.scope.lastYear,
    p_provider_mode: client.mode,
    p_expires_at: linkExpiry(args.noticeDateIso, args.now).toISOString(),
    p_public_ref: randomBytes(18).toString("base64url"),
  });
  if (error || !data) return { kind: "try_again", reason: "intent_unavailable" };
  const opened = data as { ok: boolean; reason?: string; quote?: Quote; intent?: IntentRow };
  if (!opened.ok || !opened.intent) {
    return { kind: "unavailable", reason: opened.reason ?? "not_eligible", reasons: opened.quote?.reasons };
  }

  const link = await ensureProviderLink({
    supabase,
    client,
    intent: opened.intent,
    callbackUrl: args.callbackUrl,
    schoolName: args.schoolName,
  });
  if (link.kind === "ok") return { kind: "redirect", url: link.url, intentId: opened.intent.id };
  if (link.kind === "refused") return { kind: "unavailable", reason: "provider_refused" };
  return { kind: "try_again", reason: link.reason };
}

type LinkOutcome =
  | { kind: "ok"; url: string }
  | { kind: "refused" }
  | { kind: "uncertain"; reason: string };

/**
 * Make sure the provider holds exactly one link for this intent.
 *
 * After any attempt that did not end in a clean answer, the link is LOOKED UP
 * by the intent's reference before anything is created: a timeout may have
 * created it. And if a create is refused because the reference is taken, that
 * is the same answer — the link exists — so it is fetched and recorded.
 */
export async function ensureProviderLink(args: {
  supabase: Db;
  client: RazorpayClient;
  intent: IntentRow;
  callbackUrl: string;
  schoolName: string;
}): Promise<LinkOutcome> {
  const { supabase, client, intent } = args;
  if (intent.provider_short_url) return { kind: "ok", url: intent.provider_short_url };

  const record = async (link: { id: string; short_url?: string | null }) => {
    const { error } = await supabase.rpc("online_payment_link_recorded", {
      p_intent_id: intent.id,
      p_link_id: link.id,
      p_short_url: link.short_url ?? null,
    });
    if (error) return { kind: "uncertain" as const, reason: "record_failed" };
    return link.short_url
      ? { kind: "ok" as const, url: link.short_url }
      : { kind: "uncertain" as const, reason: "no_short_url" };
  };

  if (intent.link_attempts > 0) {
    const found = await client.fetchPaymentLinkByReference(intent.provider_reference_id);
    if (found.kind === "uncertain") return { kind: "uncertain", reason: found.reason };
    if (found.kind === "ok" && found.value) return record(found.value);
  }

  const created = await client.createPaymentLink({
    amountPaise: intent.amount_paise,
    referenceId: intent.provider_reference_id,
    expireBy: new Date(intent.expires_at),
    // What the payer sees on Razorpay's page. No student detail: anyone holding
    // the link can open it.
    description: `School fee payment · ${args.schoolName}`,
    callbackUrl: args.callbackUrl,
    notes: { intent_ref: intent.public_ref, purpose: "school_fee" },
    upiOnly: client.mode === "live" && (await readUpiOnlyLinks(supabase)),
  });

  if (created.kind === "ok") return record(created.value);

  if (isDuplicateReference(created)) {
    const found = await client.fetchPaymentLinkByReference(intent.provider_reference_id);
    if (found.kind === "ok" && found.value) return record(found.value);
    await supabase.rpc("online_payment_link_failed", {
      p_intent_id: intent.id,
      p_error: "reference taken but link not found",
      p_definite: false,
    });
    return { kind: "uncertain", reason: "reference_taken" };
  }

  await supabase.rpc("online_payment_link_failed", {
    p_intent_id: intent.id,
    p_error: created.kind === "refused" ? `${created.status} ${created.description}` : created.reason,
    p_definite: created.kind === "refused",
  });
  return created.kind === "refused"
    ? { kind: "refused" }
    : { kind: "uncertain", reason: created.reason };
}

export type PaymentOutcome =
  | "applied"
  | "recorded"
  | "review_required"
  | "duplicate"
  | "waiting_for_capture"
  | "not_ours"
  | "retry";

/**
 * Look a payment up at Razorpay and, if it is captured money on one of our
 * links, record it — and post it when automatic posting is on.
 *
 * The webhook only ever supplies the payment ID. Every fact used here comes
 * from Razorpay's API under the school's key.
 */
export async function processProviderPayment(args: {
  supabase: Db;
  client: RazorpayClient;
  paymentId: string;
  autoPosting: boolean;
  actor?: string;
  /**
   * The link this payment is expected on: the intent's own link (reconciler,
   * pay page), or the one a signed `payment_link.paid` names. Only a hint —
   * the link is fetched from Razorpay and must name the payment itself.
   */
  linkId?: string | null;
}): Promise<PaymentOutcome> {
  const { supabase, client, paymentId } = args;

  const payment = await client.fetchPayment(paymentId);
  if (payment.kind === "uncertain") return "retry";
  // Under the wrong key a payment from the other mode reads as "does not exist".
  if (payment.kind === "refused") return payment.status === 400 || payment.status === 404 ? "not_ours" : "retry";

  // A checkout Order of ours (the one-tap pay page) first. Payment Links have
  // orders too, but those are not in `online_payment_orders`, so a link payment
  // falls straight through to the path below, unchanged.
  const viaOrder = await processOrderPayment({
    supabase,
    client,
    payment: payment.value,
    autoPosting: args.autoPosting,
    actor: args.actor,
  });
  if (viaOrder !== null) return viaOrder;

  const byPayment = await client.fetchPaymentLinkByPayment(paymentId);
  if (byPayment.kind === "uncertain") return "retry";
  let link = byPayment.kind === "ok" ? byPayment.value : null;

  // The first live UPI Payment Link payment (₹50, 2026-10-29) was captured,
  // webhooked and ignored as "not ours" three times over. The log that finally
  // said why: the link WAS found, both sides carried the same order, and the
  // link reported `payments: []` — which the check read as "does not list
  // this payment" (fixed in `capture-check.ts`). Two further ties are kept
  // because they are true and cost one read: the payment's `intent_ref` note,
  // which Razorpay copies from our link and a payer cannot set, and the link a
  // caller expected, fetched by id when the lookup by payment finds nothing.
  const intentRef = paymentIntentRef(payment.value);
  const intentLinkId = intentRef ? await linkIdForIntentRef(supabase, intentRef) : null;
  if (!link) {
    const linkId = args.linkId ?? intentLinkId;
    if (linkId) {
      const byId = await client.fetchPaymentLink(linkId);
      if (byId.kind === "uncertain") return "retry";
      if (
        byId.kind === "ok" &&
        byId.value &&
        (intentLinkId === byId.value.id || linkNamesPayment(byId.value, payment.value))
      ) {
        link = byId.value;
      }
    }
  }
  const intentRefMatched = link !== null && intentLinkId !== null && intentLinkId === link.id;

  const checked = checkFetchedCapture({
    payment: payment.value,
    link,
    mode: client.mode,
    intentRefMatched,
  });
  if (!checked.ok) {
    if (checked.reason === "not_captured") return "waiting_for_capture";
    // Said out loud: a captured payment refused here is money nobody posts.
    logWarn("online.payment.not_ours", {
      paymentId,
      reason: checked.reason,
      linkFound: Boolean(link),
      hinted: Boolean(args.linkId),
      paymentOrder: payment.value.order_id ?? null,
      linkOrder: link?.order_id ?? null,
      linkListsPayments: Array.isArray(link?.payments) ? link.payments.length : null,
    });
    return "not_ours";
  }

  const { data, error } = await supabase.rpc("online_payment_record_capture", { p_facts: checked.facts });
  if (error || !data) return "retry";
  const recorded = data as {
    recorded: boolean;
    duplicate?: boolean;
    capture?: { id: string; application_status: string };
    reason?: string;
  };
  // One only: the database's own refusal of a fees app link (20261031120000).
  if (recorded.reason === "not_ours") return "not_ours";
  if (!recorded.recorded || !recorded.capture) return "waiting_for_capture";

  const capture = recorded.capture;
  if (capture.application_status === "applied") return "duplicate";
  if (capture.application_status === "review_required") return "review_required";
  if (!args.autoPosting) return "recorded";

  return applyCapture(supabase, capture.id, args.actor ?? "system");
}

/** The link of the intent whose random public reference this is. */
async function linkIdForIntentRef(supabase: Db, intentRef: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("online_payment_intents")
    .select("provider_link_id")
    .eq("public_ref", intentRef)
    .maybeSingle();
  if (error) return null;
  const linkId = (data as { provider_link_id?: string | null } | null)?.provider_link_id;
  return typeof linkId === "string" && linkId ? linkId : null;
}

function linkNamesPayment(
  link: { order_id?: string | null; payments?: Array<{ payment_id: string }> | null },
  payment: { id: string; order_id?: string | null },
): boolean {
  if ((link.payments ?? []).some((entry) => entry.payment_id === payment.id)) return true;
  return Boolean(link.order_id) && link.order_id === payment.order_id;
}

export async function applyCapture(supabase: Db, captureId: string, actor: string): Promise<PaymentOutcome> {
  // An order capture posts every child's line through its own function. The
  // Payment Link function would read it as an unknown link and send it to review.
  const { data: target, error: targetError } = await supabase
    .from("online_payment_captures")
    .select("order_id, online_payment_intents(provider_reference_id)")
    .eq("id", captureId)
    .maybeSingle();
  if (targetError) return "retry";
  const found = target as { order_id?: string | null; online_payment_intents?: { provider_reference_id?: string | null } | null } | null;
  if (found?.order_id) {
    return applyOrderCapture(supabase, captureId, actor);
  }
  // One only (critique0 #2): a capture on a fees app link is the fees app's to
  // post. The database refuses it too (fee-migration 20261031120000).
  if (isFeesAppReference(found?.online_payment_intents?.provider_reference_id)) return "not_ours";
  const { data, error } = await supabase.rpc("online_payment_apply_capture", {
    p_capture_id: captureId,
    p_actor: actor,
  });
  if (error || !data) return "retry";
  const applied = data as { applied: boolean; duplicate?: boolean; status?: string };
  if (applied.applied) return applied.duplicate ? "duplicate" : "applied";
  if (applied.status === "not_ours") return "not_ours";
  return applied.status === "review_required" ? "review_required" : "recorded";
}

type EventRow = {
  id: string;
  event_type: string;
  provider_payment_id: string | null;
  provider_link_id: string | null;
  attempts: number;
};

/** Act on one inbox row, and write down how it went. */
export async function processInboxEvent(args: {
  supabase: Db;
  client: RazorpayClient;
  event: EventRow;
  switches: OnlineSwitches;
}): Promise<PaymentOutcome | "ignored" | "link_closed"> {
  const { supabase, client, event, switches } = args;
  let outcome: PaymentOutcome | "ignored" | "link_closed" = "ignored";

  if (event.provider_payment_id && !event.event_type.startsWith("refund.") && !event.event_type.includes("dispute")) {
    outcome = await processProviderPayment({
      supabase,
      client,
      paymentId: event.provider_payment_id,
      autoPosting: switches.autoPosting,
      linkId: event.provider_link_id,
    });
  } else if (
    event.provider_link_id &&
    (event.event_type === "payment_link.expired" || event.event_type === "payment_link.cancelled")
  ) {
    outcome = await closeLinkIfProviderSaysSo(supabase, client, event.provider_link_id);
  }

  const failedNow = outcome === "retry";
  // A payment still only authorised is not done: leave it pending for the
  // reconciler, which asks again until it is captured or the inbox gives up.
  const stillWaiting = outcome === "waiting_for_capture" && event.attempts < 12;
  await supabase
    .from("online_payment_events")
    .update({
      status: failedNow ? "failed" : stillWaiting ? "pending" : outcome === "ignored" || outcome === "not_ours" ? "ignored" : "processed",
      attempts: event.attempts + 1,
      last_error: failedNow ? "provider or database did not answer" : null,
      processed_at: failedNow || stillWaiting ? null : new Date().toISOString(),
    })
    .eq("id", event.id);

  return outcome;
}

/** Only Razorpay's own answer closes a link here — never the event body. */
async function closeLinkIfProviderSaysSo(
  supabase: Db,
  client: RazorpayClient,
  linkId: string,
): Promise<"link_closed" | "ignored" | PaymentOutcome> {
  const link = await client.fetchPaymentLink(linkId);
  if (link.kind !== "ok") return link.kind === "uncertain" ? "retry" : "ignored";
  const status = link.value.status;
  if (status !== "expired" && status !== "cancelled") return "ignored";
  const { data: intent } = await supabase
    .from("online_payment_intents")
    .select("id, provider_reference_id")
    .eq("provider_link_id", linkId)
    .maybeSingle();
  if (!intent) return "ignored";
  // One only: a fees app link's state is the fees app's to record.
  if (isFeesAppReference(intent.provider_reference_id)) return "ignored";
  await supabase.rpc("online_payment_link_closed", {
    p_intent_id: intent.id,
    p_status: status,
    p_reason: `provider_${status}`,
  });
  return "link_closed";
}

/** Process an inbox row by id — the webhook's `after()` hand-off. */
export async function processInboxEventById(args: {
  supabase: Db;
  client: RazorpayClient;
  eventId: string;
}) {
  const { data: event } = await args.supabase
    .from("online_payment_events")
    .select("id, event_type, provider_payment_id, provider_link_id, attempts, status")
    .eq("id", args.eventId)
    .maybeSingle();
  if (!event || !["pending", "failed"].includes(event.status)) return null;
  const switches = await readOnlineSwitches(args.supabase);
  return processInboxEvent({ supabase: args.supabase, client: args.client, event, switches });
}

export { readRazorpayEvent };

export type ReceiptSender = (job: {
  receiptId: string;
  receiptNumber: string;
  studentId: string;
  sessionLabel: string;
  amountPaid: number;
  paymentDate: string;
}) => Promise<
  | { outcome: "provider_accepted"; providerMessageId: string | null }
  | { outcome: "suppressed" | "failed" | "uncertain"; reason: string }
>;

export type ReconcileReport = {
  events: number;
  linksChecked: number;
  ordersChecked: number;
  linksCancelled: number;
  capturesApplied: number;
  receiptsSent: number;
  receiptsSuppressed: number;
  stoppedEarly: boolean;
};

/**
 * One bounded pass of everything the webhook may have missed. Run by the
 * ten-minute timer; safe to run twice at once, because every step it takes is
 * either idempotent in the database or claimed with a lease.
 */
export async function reconcileOnlinePayments(args: {
  supabase: Db;
  client: RazorpayClient;
  sendReceipt: ReceiptSender;
  /**
   * Run before the outbox step with the payments this pass posted: drain the
   * matview so a receipt quotes the balance after the payment, and refresh the
   * caches and staff tabs (`after-posting.ts`, injected so this file does not
   * import it).
   */
  afterPosting?: (paymentIds: string[]) => Promise<void>;
  budgetMs?: number;
  now?: () => number;
}): Promise<ReconcileReport> {
  const { supabase, client } = args;
  const now = args.now ?? Date.now;
  const deadline = now() + (args.budgetMs ?? 40_000);
  const outOfTime = () => now() > deadline;
  const report: ReconcileReport = {
    events: 0,
    linksChecked: 0,
    ordersChecked: 0,
    linksCancelled: 0,
    capturesApplied: 0,
    receiptsSent: 0,
    receiptsSuppressed: 0,
    stoppedEarly: false,
  };
  const switches = await readOnlineSwitches(supabase);
  const posted: string[] = [];

  // 1. The inbox: anything the webhook recorded but could not finish.
  const { data: events } = await supabase
    .from("online_payment_events")
    .select("id, event_type, provider_payment_id, provider_link_id, attempts, status")
    .in("status", ["pending", "failed"])
    .lt("attempts", 12)
    .order("received_at", { ascending: true })
    .limit(25);
  for (const event of (events ?? []) as EventRow[]) {
    if (outOfTime()) return { ...report, stoppedEarly: true };
    const outcome = await processInboxEvent({ supabase, client, event, switches });
    if (outcome === "applied" && event.provider_payment_id) posted.push(event.provider_payment_id);
    report.events += 1;
  }

  // 2. Open and recently closed links: ask Razorpay what happened to each.
  // A payment the webhook never told us about is found here, including one
  // that arrived after the link expired or was superseded.
  const { data: intents } = await supabase
    .from("online_payment_intents")
    .select("id, status, provider_reference_id, provider_link_id, provider_short_url, provider_cancelled_at, link_attempts, updated_at")
    .or(
      "status.in.(link_pending,link_created),and(status.in.(superseded,expired,cancelled,failed),provider_cancelled_at.is.null)",
    )
    // One only (critique0 #2): never the fees app's links (`vpps_…`). The
    // fees app owns them — asking about one could record its capture here, or
    // cancel a link a parent was sent by the fees app.
    .not("provider_reference_id", "like", `${FEES_APP_REFERENCE_PREFIX}%`)
    // Least recently looked at first, so thirty a pass still reaches every
    // open link in turn.
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(30);

  for (const intent of (intents ?? []) as Array<{
    id: string;
    status: string;
    provider_reference_id: string;
    provider_link_id: string | null;
    provider_cancelled_at: string | null;
    link_attempts: number;
    updated_at: string;
  }>) {
    if (outOfTime()) return { ...report, stoppedEarly: true };
    if (isFeesAppReference(intent.provider_reference_id)) continue;
    report.linksChecked += 1;
    await supabase
      .from("online_payment_intents")
      .update({ last_reconciled_at: new Date(now()).toISOString() })
      .eq("id", intent.id);

    const linkResult = intent.provider_link_id
      ? await client.fetchPaymentLink(intent.provider_link_id)
      : await client.fetchPaymentLinkByReference(intent.provider_reference_id);
    if (linkResult.kind !== "ok") continue;
    const link = linkResult.value;

    if (!link) {
      const ageMs = now() - new Date(intent.updated_at).getTime();
      if (intent.status === "link_pending" && ageMs > 10 * 60 * 1000) {
        // Nothing at Razorpay for an intent that never got a link: after ten
        // minutes that is a definite answer, and the student's slot is freed.
        await supabase.rpc("online_payment_link_failed", {
          p_intent_id: intent.id,
          p_error: "no link at provider after an uncertain create",
          p_definite: true,
        });
      } else if (intent.status !== "link_pending" && intent.status !== "link_created") {
        // A closed intent with no link anywhere: nothing can take money.
        await supabase.rpc("online_payment_link_closed", {
          p_intent_id: intent.id,
          p_status: "cancelled",
          p_reason: "no_link_at_provider",
        });
      }
      continue;
    }

    if (!intent.provider_link_id) {
      await supabase.rpc("online_payment_link_recorded", {
        p_intent_id: intent.id,
        p_link_id: link.id,
        p_short_url: (link as { short_url?: string }).short_url ?? null,
      });
    }

    for (const payment of link.payments ?? []) {
      if (payment.status && payment.status !== "captured") continue;
      const outcome = await processProviderPayment({
        supabase,
        client,
        paymentId: payment.payment_id,
        autoPosting: switches.autoPosting,
        linkId: link.id,
      });
      if (outcome === "applied") {
        report.capturesApplied += 1;
        posted.push(payment.payment_id);
      }
    }

    const superseded = ["superseded", "expired", "cancelled", "failed"].includes(intent.status);
    if (superseded && (link.status === "paid" || link.status === "partially_paid")) {
      // Paid after the school had moved on: the payments above were recorded
      // for review. The link can take nothing more, so stop watching it.
      await supabase.rpc("online_payment_link_closed", {
        p_intent_id: intent.id,
        p_status: "cancelled",
        p_reason: "paid_after_close",
      });
    } else if (link.status === "created" && superseded) {
      const cancelled = await client.cancelPaymentLink(link.id);
      if (cancelled.kind === "ok") {
        await supabase.rpc("online_payment_link_closed", {
          p_intent_id: intent.id,
          p_status: "cancelled",
          p_reason: "superseded_at_school",
        });
        report.linksCancelled += 1;
      }
    } else if (link.status === "expired" || link.status === "cancelled") {
      await supabase.rpc("online_payment_link_closed", {
        p_intent_id: intent.id,
        p_status: link.status,
        p_reason: `provider_${link.status}`,
      });
    }
  }

  // 2b. Checkout orders from the one-tap pay page: the same question, per order.
  if (!outOfTime()) {
    const orders = await reconcileOpenOrders({ supabase, client, autoPosting: switches.autoPosting, now, outOfTime });
    report.ordersChecked += orders.checked;
    report.capturesApplied += orders.posted.length;
    posted.push(...orders.posted);
  }

  // 3. Captures recorded while automatic posting was off, once it is on.
  if (switches.autoPosting) {
    const { data: pending } = await supabase
      .from("online_payment_captures")
      .select("id, provider_payment_id")
      .eq("application_status", "pending")
      .limit(25);
    for (const capture of (pending ?? []) as Array<{ id: string; provider_payment_id: string }>) {
      if (outOfTime()) return { ...report, stoppedEarly: true };
      if ((await applyCapture(supabase, capture.id, "reconciler")) === "applied") {
        report.capturesApplied += 1;
        posted.push(capture.provider_payment_id);
      }
    }
  }

  // Views, caches and staff tabs BEFORE any receipt is sent: the receipt reads
  // its balance from the matview.
  if (posted.length > 0 && args.afterPosting) {
    try {
      await args.afterPosting(posted);
    } catch {
      // Best-effort; the money has posted and the two-minute drain still runs.
    }
  }

  // 4. The receipt outbox.
  const drained = await drainReceiptOutbox({ supabase, sendReceipt: args.sendReceipt, switches, outOfTime });
  report.receiptsSent += drained.sent;
  report.receiptsSuppressed += drained.suppressed;
  if (drained.stoppedEarly) report.stoppedEarly = true;
  return report;
}

/**
 * Send queued receipt notices. A job is leased, so a second worker does not
 * take it; a lease that ran out (the worker died mid-send) is taken again, and
 * the receipt-level claim in `whatsapp_reminder_sends` — unique per receipt —
 * is what stops that second take reaching the parent twice.
 */
export async function drainReceiptOutbox(args: {
  supabase: Db;
  sendReceipt: ReceiptSender;
  switches: OnlineSwitches;
  outOfTime?: () => boolean;
}): Promise<{ sent: number; suppressed: number; stoppedEarly: boolean }> {
  const { supabase } = args;
  const { data: jobs, error } = await supabase.rpc("notification_outbox_claim", {
    p_limit: 10,
    p_lease_seconds: 120,
  });
  if (error) return { sent: 0, suppressed: 0, stoppedEarly: false };

  let sent = 0;
  let suppressed = 0;
  for (const job of (jobs ?? []) as Array<{
    id: string;
    receipt_id: string;
    student_id: string;
    session_label: string;
    attempts: number;
    max_attempts: number;
    payload: { receipt_number?: string; amount?: number; payment_date?: string };
  }>) {
    if (args.outOfTime?.()) {
      // Hand it straight back rather than letting the lease run out.
      await complete(supabase, job.id, "queued", null, null, 0);
      return { sent, suppressed, stoppedEarly: true };
    }
    if (!args.switches.receipts) {
      await complete(supabase, job.id, "suppressed", null, "Online receipt delivery is switched off.", null);
      suppressed += 1;
      continue;
    }
    const result = await args.sendReceipt({
      receiptId: job.receipt_id,
      receiptNumber: String(job.payload?.receipt_number ?? ""),
      studentId: job.student_id,
      sessionLabel: job.session_label,
      amountPaid: Number(job.payload?.amount ?? 0),
      paymentDate: String(job.payload?.payment_date ?? ""),
    });
    if (result.outcome === "provider_accepted") {
      await complete(supabase, job.id, "provider_accepted", result.providerMessageId, null, null);
      sent += 1;
    } else if (result.outcome === "suppressed" || result.outcome === "uncertain") {
      // Uncertain is NOT retried: the provider may already have the message,
      // and AiSensy offers no way to ask. It is shown to the office instead.
      await complete(supabase, job.id, result.outcome, null, result.reason, null);
      if (result.outcome === "suppressed") suppressed += 1;
    } else {
      const last = job.attempts >= job.max_attempts;
      await complete(supabase, job.id, "failed", null, result.reason, last ? null : 60 * 2 ** job.attempts);
    }
  }
  return { sent, suppressed, stoppedEarly: false };
}

async function complete(
  supabase: Db,
  id: string,
  status: string,
  providerMessageId: string | null,
  error: string | null,
  retryInSeconds: number | null,
) {
  await supabase.rpc("notification_outbox_complete", {
    p_id: id,
    p_status: status,
    p_provider_message_id: providerMessageId,
    p_error: error,
    p_retry_in_seconds: retryInSeconds,
  });
}
