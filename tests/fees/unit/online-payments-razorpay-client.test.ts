import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRazorpayClient,
  isDuplicateReference,
  readRazorpayConfig,
} from "@/modules/payments/data/online/razorpay-client";

const config = { keyId: "rzp_test_fake", keySecret: "fake_secret", mode: "test" as const };

function respond(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("Razorpay client", () => {
  it("creates a fixed-amount link in paise with Razorpay's own SMS, e-mail and reminders off", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, { id: "plink_1", short_url: "https://rzp.io/i/x", reference_id: "vp1_1" }));
    const client = createRazorpayClient(config, fetchImpl);
    const result = await client.createPaymentLink({
      amountPaise: 800000,
      referenceId: "vp1_1",
      expireBy: new Date("2026-11-01T18:29:00Z"),
      description: "School fee payment",
      callbackUrl: "https://example.test/pay/code?returned=1",
      notes: { intent_ref: "ref" },
    });
    expect(result.kind).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/payment_links");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      amount: 800000,
      currency: "INR",
      accept_partial: false,
      reference_id: "vp1_1",
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_method: "get",
    });
    expect(body.expire_by).toBe(Math.floor(new Date("2026-11-01T18:29:00Z").getTime() / 1000));
    expect(body).not.toHaveProperty("customer");
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it("asks for a UPI Payment Link only when told to", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, { id: "plink_1", short_url: "https://rzp.io/i/x", reference_id: "vp1_1" }));
    const client = createRazorpayClient(config, fetchImpl);
    const base = {
      amountPaise: 5000, referenceId: "vp1_1", expireBy: new Date(Date.now() + 3600_000), description: "x", callbackUrl: "https://x.test", notes: {},
    };
    await client.createPaymentLink(base);
    await client.createPaymentLink({ ...base, upiOnly: true });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("upi_link");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({ upi_link: true, accept_partial: false, amount: 5000 });
  });

  it("calls a timeout, a network error, a 5xx and a 429 UNCERTAIN — never a failure", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    for (const fetchImpl of [
      vi.fn().mockRejectedValue(abort),
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      vi.fn().mockResolvedValue(respond(502, "bad gateway")),
      vi.fn().mockResolvedValue(respond(429, {})),
    ]) {
      const result = await createRazorpayClient(config, fetchImpl).fetchPayment("pay_1");
      expect(result.kind).toBe("uncertain");
    }
  });

  it("recognises a reused reference, which means the link already exists", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(400, { error: { code: "BAD_REQUEST_ERROR", description: "payment link creation with reference ID already attempted" } }));
    const result = await createRazorpayClient(config, fetchImpl).createPaymentLink({
      amountPaise: 100, referenceId: "vp1_1", expireBy: new Date(Date.now() + 3600_000), description: "x", callbackUrl: "https://x.test", notes: {},
    });
    expect(result.kind).toBe("refused");
    expect(isDuplicateReference(result)).toBe(true);
  });

  it("finds a link by its exact reference only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, { payment_links: [{ id: "plink_other", reference_id: "vp1_10" }, { id: "plink_mine", reference_id: "vp1_1" }] }));
    const result = await createRazorpayClient(config, fetchImpl).fetchPaymentLinkByReference("vp1_1");
    expect(result).toEqual({ kind: "ok", value: { id: "plink_mine", reference_id: "vp1_1" } });
    expect(fetchImpl.mock.calls[0][0]).toContain("reference_id=vp1_1");
  });

  it("reads where the hosted page sends an Android phone, without sending the key", async () => {
    const upi = "upi://pay?am=50.00&cu=INR&pa=school123.rzp@rxairtel&tr=TtFakeRef123";
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: upi } }));
    const result = await createRazorpayClient(config, fetchImpl).fetchUpiIntentUri("plink_1");
    expect(result).toBe(upi);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://razorpay.com/payment-link/plink_1");
    expect(init.redirect).toBe("manual");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(init.headers["User-Agent"]).toMatch(/Android/);
  });

  it("reads no UPI redirect from a page, an https redirect, or a failed request", async () => {
    for (const fetchImpl of [
      vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })),
      vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://razorpay.com/x" } })),
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    ]) {
      expect(await createRazorpayClient(config, fetchImpl).fetchUpiIntentUri("plink_1")).toBeNull();
    }
  });

  it("creates a checkout order in paise, captured automatically with a twelve-hour window, carrying our references only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, { id: "order_1", amount: 25000 }));
    const result = await createRazorpayClient(config, fetchImpl).createOrder({
      amountPaise: 25000,
      receipt: "vp1_o_0123456789abcdef0123456789abcdef",
      notes: { intent_ref: "ref_aaaaaaaaaaaaaaaaaaaaaa", purpose: "school_fee" },
    });
    expect(result).toEqual({ kind: "ok", value: { id: "order_1", amount: 25000 } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      amount: 25000,
      currency: "INR",
      receipt: "vp1_o_0123456789abcdef0123456789abcdef",
      notes: { intent_ref: "ref_aaaaaaaaaaaaaaaaaaaaaa", purpose: "school_fee" },
      payment: { capture: "automatic", capture_options: { automatic_expiry_period: 720, manual_expiry_period: 720, refund_speed: "optimum" } },
    });
    expect(body.receipt.length).toBeLessThanOrEqual(40);
  });

  it("lists an order's payments", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, { items: [{ id: "pay_1", status: "captured" }] }));
    const result = await createRazorpayClient(config, fetchImpl).fetchOrderPayments("order_1");
    expect(result).toEqual({ kind: "ok", value: [{ id: "pay_1", status: "captured" }] });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.razorpay.com/v1/orders/order_1/payments");
  });

  it("is unconfigured without both keys, or with a key of unknown mode", () => {
    expect(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_live_x" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(readRazorpayConfig({ RAZORPAY_KEY_ID: "pk_x", RAZORPAY_KEY_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      readRazorpayConfig({
        RAZORPAY_KEY_ID: "rzp_live_x",
        RAZORPAY_KEY_SECRET: "s",
        VPPSONE_ENV: "live",
        VERCEL_ENV: "production",
      } as unknown as NodeJS.ProcessEnv)?.mode,
    ).toBe("live");
    expect(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s" } as unknown as NodeJS.ProcessEnv)?.mode).toBe("test");
  });

  // One only (go-live Phase E, plan §7.6): a live key moves real money, so it
  // counts only on a deployment that is Vercel production AND declares
  // VPPSONE_ENV=live. Anywhere else it reads as no key at all.
  it("refuses a live key outside a live production deployment", () => {
    const live = { RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s" };
    for (const env of [
      {},
      { VPPSONE_ENV: "dev", VERCEL_ENV: "production" },
      { VERCEL_ENV: "production" },
      { VPPSONE_ENV: "live", VERCEL_ENV: "preview" },
      { VPPSONE_ENV: "live" },
    ]) {
      expect(readRazorpayConfig({ ...live, ...env } as unknown as NodeJS.ProcessEnv), JSON.stringify(env)).toBeNull();
    }
    // Test keys are allowed on every deployment, Preview and local included.
    expect(
      readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s", VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)?.mode,
    ).toBe("test");
  });
});
