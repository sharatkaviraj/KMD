/**
 * Is this FETCHED payment money we may record against one of our checkout
 * Orders (the one-tap pay page)?
 *
 * Called with what `GET /payments/{id}` returned under the school's key and the
 * Razorpay order id we stored when the order was created — never with a
 * checkout handler's fields, a webhook body or anything a parent typed. The
 * database repeats the amount, currency and mode checks against the stored
 * order.
 */

import type { FetchedPayment, RazorpayMode } from "./capture-check";

export type FetchedOrder = {
  id: string;
  amount: number;
  amount_paid?: number;
  amount_due?: number;
  status?: string;
  receipt?: string | null;
  notes?: Record<string, unknown> | unknown[] | null;
};

/** The shape `public.online_payment_record_order_capture` takes. */
export type OrderCaptureFacts = {
  provider_payment_id: string;
  provider_order_id: string;
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

export type OrderCaptureCheck =
  | { ok: true; facts: OrderCaptureFacts }
  | { ok: false; reason: "not_captured" | "bad_amount" | "order_mismatch" };

export function checkFetchedOrderCapture(args: {
  payment: FetchedPayment;
  /** OUR stored Razorpay order id — the payment must carry exactly this one. */
  providerOrderId: string;
  mode: RazorpayMode;
}): OrderCaptureCheck {
  const { payment, providerOrderId, mode } = args;
  if (payment.status !== "captured" || payment.captured !== true) return { ok: false, reason: "not_captured" };
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) return { ok: false, reason: "bad_amount" };
  if (!payment.order_id || payment.order_id !== providerOrderId) return { ok: false, reason: "order_mismatch" };
  return {
    ok: true,
    facts: {
      provider_payment_id: payment.id,
      provider_order_id: providerOrderId,
      provider_mode: mode,
      amount_paise: payment.amount,
      currency: String(payment.currency ?? "").toUpperCase(),
      provider_status: "captured",
      captured: true,
      method: payment.method ?? null,
      fee_paise: typeof payment.fee === "number" ? payment.fee : null,
      tax_paise: typeof payment.tax === "number" ? payment.tax : null,
      captured_at: typeof payment.created_at === "number" ? new Date(payment.created_at * 1000).toISOString() : null,
    },
  };
}
