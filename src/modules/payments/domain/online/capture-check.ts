/**
 * Is this FETCHED payment money we may record against one of our links?
 *
 * Called with what the Razorpay API returned for `GET /payments/{id}` and for
 * the payment link it belongs to — never with a webhook body, a redirect query
 * string or anything a parent typed. The database repeats the amount, currency
 * and mode checks against the stored intent; this decides whether the facts
 * are coherent enough to hand over at all.
 */

export type RazorpayMode = "test" | "live";

export type FetchedPayment = {
  id: string;
  entity?: string;
  amount: number;
  currency: string;
  status: string;
  captured?: boolean;
  order_id?: string | null;
  method?: string | null;
  fee?: number | null;
  tax?: number | null;
  created_at?: number | null;
  /** Razorpay copies the link's notes onto its payment; a payer cannot set them. */
  notes?: Record<string, unknown> | unknown[] | null;
};

export type FetchedPaymentLink = {
  id: string;
  reference_id?: string | null;
  order_id?: string | null;
  status?: string;
  amount?: number;
  amount_paid?: number;
  payments?: Array<{ payment_id: string; status?: string }> | null;
};

export type CaptureCheck =
  | { ok: true; facts: CaptureFacts }
  | { ok: false; reason: CaptureRefusal };

export type CaptureRefusal =
  | "not_captured"
  | "not_our_link"
  | "link_does_not_list_payment"
  | "order_mismatch"
  | "bad_amount";

/** The shape `public.online_payment_record_capture` takes. */
export type CaptureFacts = {
  provider_payment_id: string;
  provider_link_id: string;
  reference_id: string;
  provider_mode: RazorpayMode;
  amount_paise: number;
  currency: string;
  provider_status: "captured";
  captured: true;
  method: string | null;
  fee_paise: number | null;
  tax_paise: number | null;
  captured_at: string | null;
};

/**
 * Our references, and only ours, start with this.
 *
 * One only (go-live Phase E, plan §7.3, critique0 #2): the fees app mints
 * `vpps_…` (links) and `vpps_o_…` (orders), and both apps' webhooks receive
 * every event on the school's one Razorpay account. One mints `vp1_…` and
 * `vp1_o_…` (fee-migration 20261031120000), so the fees app's own
 * `startsWith("vpps_")` check ignores One's payments, and this check ignores
 * the fees app's. A `vp1_` reference does not start with `vpps_`, and the
 * reverse, so neither prefix can be mistaken for the other.
 */
export const REFERENCE_PREFIX = "vp1_";

/** The fees app's references. One never records, posts or reconciles money on one. */
export const FEES_APP_REFERENCE_PREFIX = "vpps_";

/**
 * Was this link reference or order receipt minted by the fees app? Such a row
 * can be in One's database only because it was imported; the fees app owns
 * its money, and posts it in its own ledger.
 */
export function isFeesAppReference(reference: string | null | undefined): boolean {
  return String(reference ?? "").startsWith(FEES_APP_REFERENCE_PREFIX);
}

export function modeOfKey(keyId: string): RazorpayMode | null {
  if (keyId.startsWith("rzp_live_")) return "live";
  if (keyId.startsWith("rzp_test_")) return "test";
  return null;
}

/** The `intent_ref` note Razorpay carried onto a payment from our link, if any. */
export function paymentIntentRef(payment: Pick<FetchedPayment, "notes">): string | null {
  const notes = payment.notes;
  if (!notes || Array.isArray(notes)) return null;
  const ref = (notes as Record<string, unknown>).intent_ref;
  return typeof ref === "string" && ref.length >= 16 ? ref : null;
}

export function checkFetchedCapture(args: {
  payment: FetchedPayment;
  link: FetchedPaymentLink | null;
  mode: RazorpayMode;
  /**
   * True when the payment's own `intent_ref` note is the random reference of
   * the intent that holds this link. That is Razorpay tying the two, and it is
   * how a UPI Payment Link's payment is recognised: Razorpay takes it as a QR
   * payment, which neither the link's payment list nor its order shows.
   */
  intentRefMatched?: boolean;
}): CaptureCheck {
  const { payment, link, mode } = args;

  // Authorised is not money. Payment Links capture automatically; a payment
  // that is only authorised waits for its `payment.captured`.
  if (payment.status !== "captured" || payment.captured !== true) {
    return { ok: false, reason: "not_captured" };
  }
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
    return { ok: false, reason: "bad_amount" };
  }
  if (!link || !String(link.reference_id ?? "").startsWith(REFERENCE_PREFIX)) {
    return { ok: false, reason: "not_our_link" };
  }
  // The link must name this payment, and both must belong to one order: a
  // payment id lifted from another merchant flow cannot borrow our link. The
  // intent reference is the other proof of the same thing.
  if (!args.intentRefMatched) {
    // An EMPTY list is "not listed yet", not a contradiction: a UPI Payment Link
    // reports `payments: []` for money it has taken (production, 2026-10-29,
    // same order on both sides). A list naming OTHER payments still refuses.
    if (link.payments && link.payments.length > 0 && !link.payments.some((entry) => entry.payment_id === payment.id)) {
      return { ok: false, reason: "link_does_not_list_payment" };
    }
    if (link.order_id && payment.order_id && link.order_id !== payment.order_id) {
      return { ok: false, reason: "order_mismatch" };
    }
  }

  return {
    ok: true,
    facts: {
      provider_payment_id: payment.id,
      provider_link_id: link.id,
      reference_id: String(link.reference_id),
      provider_mode: mode,
      amount_paise: payment.amount,
      currency: String(payment.currency ?? "").toUpperCase(),
      provider_status: "captured",
      captured: true,
      method: payment.method ?? null,
      fee_paise: typeof payment.fee === "number" ? payment.fee : null,
      tax_paise: typeof payment.tax === "number" ? payment.tax : null,
      captured_at:
        typeof payment.created_at === "number"
          ? new Date(payment.created_at * 1000).toISOString()
          : null,
    },
  };
}
