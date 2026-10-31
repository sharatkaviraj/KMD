/**
 * What a Razorpay webhook is allowed to tell us.
 *
 * An event is a NUDGE, never proof. It says "go and look at payment X" or
 * "link Y changed"; the processor then fetches the payment from Razorpay with
 * the API key and decides from that. Nothing here marks anything paid.
 *
 * So this keeps ids, the event type and the amounts the office may want to
 * see in the inbox, and drops everything personal: contact numbers, e-mail
 * addresses, VPAs and card details in the payload are never stored.
 */

export const HANDLED_EVENTS = new Set([
  "payment_link.paid",
  "payment_link.partially_paid",
  "payment_link.expired",
  "payment_link.cancelled",
  "payment.captured",
  "payment.authorized",
  "payment.failed",
  // A checkout Order (one-tap pay page) paid. Carries the payment, so it is
  // handled exactly like payment.captured: fetch the payment, then decide.
  "order.paid",
  // Not acted on automatically: a refund or dispute is a separately
  // authorised accounting act. Recorded so the office sees it.
  "refund.created",
  "refund.processed",
  "payment.dispute.created",
]);

export type RazorpayEventFacts = {
  eventType: string;
  accountId: string | null;
  paymentId: string | null;
  paymentLinkId: string | null;
  /** Redacted: safe to store and show. */
  facts: Record<string, string | number | boolean | null>;
};

type Json = Record<string, unknown>;

function entity(payload: Json | undefined, key: string): Json | null {
  const holder = payload?.[key];
  if (!holder || typeof holder !== "object") return null;
  const inner = (holder as Json).entity;
  return inner && typeof inner === "object" ? (inner as Json) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Null when the body is not an event at all. */
export function readRazorpayEvent(body: unknown): RazorpayEventFacts | null {
  if (!body || typeof body !== "object") return null;
  const event = body as Json;
  if (event.entity !== "event") return null;
  const eventType = str(event.event);
  if (!eventType) return null;

  const payload = (event.payload ?? {}) as Json;
  const payment = entity(payload, "payment");
  const link = entity(payload, "payment_link");
  const refund = entity(payload, "refund");
  const order = entity(payload, "order");

  const paymentId =
    str(payment?.id) ?? str(refund?.payment_id) ?? null;
  const paymentLinkId = str(link?.id);

  return {
    eventType,
    accountId: str(event.account_id),
    paymentId: paymentId && /^pay_[A-Za-z0-9]+$/.test(paymentId) ? paymentId : null,
    paymentLinkId: paymentLinkId && /^plink_[A-Za-z0-9]+$/.test(paymentLinkId) ? paymentLinkId : null,
    facts: {
      payment_status: str(payment?.status),
      payment_amount: num(payment?.amount),
      payment_currency: str(payment?.currency),
      payment_method: str(payment?.method),
      link_status: str(link?.status),
      link_amount: num(link?.amount),
      link_amount_paid: num(link?.amount_paid),
      link_reference_id: str(link?.reference_id),
      order_id: str(order?.id) ?? str(payment?.order_id),
      order_status: str(order?.status),
      refund_id: str(refund?.id),
      refund_amount: num(refund?.amount),
      created_at: num(event.created_at),
    },
  };
}
