import "server-only";

import {
  modeOfKey,
  type FetchedPayment,
  type FetchedPaymentLink,
  type RazorpayMode,
} from "@/modules/payments/domain/online/capture-check";
import { razorpayKeyRefusal } from "@/modules/payments/domain/online/key-guard";
import type { FetchedOrder } from "@/modules/payments/domain/online/order-capture-check";
import { logWarn } from "@/platform/observability/log";

/**
 * Razorpay REST client: Payment Links, Orders and Payments, nothing else — plus
 * one read of the hosted link page, for the `upi://` it redirects Android to.
 *
 * Every call answers one of three ways, and the difference is the whole point:
 *
 *   ok         Razorpay answered and said yes.
 *   refused    Razorpay answered and said no (a 4xx). Nothing happened there.
 *   uncertain  No answer we can trust — a timeout, a network error, a 5xx. The
 *              thing MAY have happened. The caller must look (fetch by the
 *              reference it chose) before it tries again.
 *
 * Keys come from `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`, server-side only.
 * The mode (test or live) is read from the key itself, so a test key can never
 * be mistaken for a live one by a separate setting drifting.
 */

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 8000;
/** Razorpay's hosted link page, which sends an Android phone on to `upi://`. */
const HOSTED_LINK_PAGE = "https://razorpay.com/payment-link";
const ANDROID_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

export type RazorpayResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "refused"; status: number; code: string | null; description: string }
  | { kind: "uncertain"; reason: string };

export type RazorpayConfig = { keyId: string; keySecret: string; mode: RazorpayMode };

export function readRazorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim() ?? "";
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  const mode = modeOfKey(keyId);
  if (!keyId || !keySecret || !mode) return null;
  // One only: a live key outside a live deployment is no key at all
  // (`domain/online/key-guard.ts`). Every caller already treats null as "not
  // configured", so nothing opens, and the refusal is said once per instance.
  const refusal = razorpayKeyRefusal(mode, env);
  if (refusal) {
    if (!warnedLiveKey) {
      warnedLiveKey = true;
      logWarn("online.razorpay.live_key_refused", { reason: refusal });
    }
    return null;
  }
  return { keyId, keySecret, mode };
}

let warnedLiveKey = false;

export type RazorpayClient = ReturnType<typeof createRazorpayClient>;

export function createRazorpayClient(
  config: RazorpayConfig,
  fetchImpl: typeof fetch = fetch,
) {
  const authorization = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<RazorpayResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        method,
        headers: {
          Authorization: authorization,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (caught) {
      return {
        kind: "uncertain",
        reason: caught instanceof Error && caught.name === "AbortError" ? "timeout" : "network",
      };
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (response.status >= 500 || response.status === 429) {
      return { kind: "uncertain", reason: `http_${response.status}` };
    }
    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; description?: string } } | null)?.error;
      return {
        kind: "refused",
        status: response.status,
        code: error?.code ?? null,
        // Razorpay's own words, trimmed. Never contains our key.
        description: String(error?.description ?? "").slice(0, 300),
      };
    }
    if (parsed === null) return { kind: "uncertain", reason: "unreadable_body" };
    return { kind: "ok", value: parsed as T };
  }

  return {
    mode: config.mode,

    /**
     * A fixed-amount Payment Link. Razorpay's own SMS, e-mail and reminders are
     * OFF: WhatsApp through AiSensy is the school's channel, and a second
     * channel nobody approved would message parents twice.
     *
     * `upiOnly` makes it a UPI Payment Link: on Android the payer goes from the
     * link straight to their UPI apps, skipping the standard page's contact and
     * method screens. No cards or netbanking, and Live mode only.
     */
    createPaymentLink(args: {
      amountPaise: number;
      referenceId: string;
      expireBy: Date;
      description: string;
      callbackUrl: string;
      notes: Record<string, string>;
      upiOnly?: boolean;
    }) {
      return call<FetchedPaymentLink & { short_url: string }>("POST", "/payment_links", {
        ...(args.upiOnly ? { upi_link: true } : {}),
        amount: args.amountPaise,
        currency: "INR",
        accept_partial: false,
        reference_id: args.referenceId,
        expire_by: Math.floor(args.expireBy.getTime() / 1000),
        description: args.description.slice(0, 2048),
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: args.notes,
        callback_url: args.callbackUrl,
        callback_method: "get",
      });
    },

    fetchPaymentLink(linkId: string) {
      return call<FetchedPaymentLink & { short_url?: string }>("GET", `/payment_links/${encodeURIComponent(linkId)}`);
    },

    async fetchPaymentLinkByReference(referenceId: string) {
      const result = await call<{ payment_links?: Array<FetchedPaymentLink & { short_url?: string }> }>(
        "GET",
        `/payment_links?reference_id=${encodeURIComponent(referenceId)}`,
      );
      if (result.kind !== "ok") return result;
      const link = (result.value.payment_links ?? []).find((entry) => entry.reference_id === referenceId) ?? null;
      return { kind: "ok" as const, value: link };
    },

    async fetchPaymentLinkByPayment(paymentId: string) {
      const result = await call<{ payment_links?: FetchedPaymentLink[] }>(
        "GET",
        `/payment_links?payment_id=${encodeURIComponent(paymentId)}`,
      );
      if (result.kind !== "ok") return result;
      return { kind: "ok" as const, value: (result.value.payment_links ?? [])[0] ?? null };
    },

    cancelPaymentLink(linkId: string) {
      return call<FetchedPaymentLink>("POST", `/payment_links/${encodeURIComponent(linkId)}/cancel`);
    },

    fetchPayment(paymentId: string) {
      return call<FetchedPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
    },

    /**
     * A checkout Order for the one-tap pay page: one per tap on Pay, for the
     * total of the parent's lines. Captured automatically, with the window
     * stretched to twelve hours, so a late UPI authorisation is still captured
     * (and posted, if it fits) rather than refunded. `receipt` and `notes`
     * carry our references only — never a student detail.
     */
    createOrder(args: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
      return call<FetchedOrder>("POST", "/orders", {
        amount: args.amountPaise,
        currency: "INR",
        receipt: args.receipt.slice(0, 40),
        notes: args.notes,
        payment: {
          capture: "automatic",
          capture_options: { automatic_expiry_period: 720, manual_expiry_period: 720, refund_speed: "optimum" },
        },
      });
    },

    fetchOrder(orderId: string) {
      return call<FetchedOrder>("GET", `/orders/${encodeURIComponent(orderId)}`);
    },

    async fetchOrderPayments(orderId: string) {
      const result = await call<{ items?: FetchedPayment[] }>("GET", `/orders/${encodeURIComponent(orderId)}/payments`);
      if (result.kind !== "ok") return result;
      return { kind: "ok" as const, value: result.value.items ?? [] };
    },

    /**
     * Where a UPI Payment Link sends an Android phone: the `upi://pay?…` its
     * hosted page answers with as an HTTP 302. Read here so the pay page can
     * show it as a button, because WhatsApp's browser will not follow that
     * redirect itself (`domain/online/upi-launch.ts`).
     *
     * The public page, not the API: no key is sent. Null for anything but a
     * redirect to `upi://` — a standard link, a paid or expired one, a timeout.
     * The caller checks the URI before showing it.
     *
     * Reading this page is also what makes Razorpay open the link's Order: a
     * link has no `order_id` until it has been read once (probed 2026-10-30).
     */
    async fetchUpiIntentUri(linkId: string): Promise<string | null> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS / 2);
      try {
        const response = await fetchImpl(`${HOSTED_LINK_PAGE}/${encodeURIComponent(linkId)}`, {
          method: "GET",
          headers: { "User-Agent": ANDROID_USER_AGENT },
          redirect: "manual",
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.status < 300 || response.status >= 400) return null;
        const location = response.headers.get("location");
        return location && /^upi:\/\//i.test(location) ? location : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Razorpay's words for "this reference was already used". */
export function isDuplicateReference(result: RazorpayResult<unknown>): boolean {
  return result.kind === "refused" && /reference id already/i.test(result.description);
}
