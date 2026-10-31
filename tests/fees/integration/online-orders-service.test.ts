import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  cancelLinksByReference,
  openCheckoutOrder,
  processOrderPayment,
  refreshOrderStatus,
  type PayWith,
} from "@/modules/payments/data/online/orders";
import type { RazorpayClient, RazorpayResult } from "@/modules/payments/data/online/razorpay-client";
import { applyCapture, processProviderPayment } from "@/modules/payments/data/online/service";

type RpcHandler = (args: Record<string, unknown>) => unknown;

/** RPCs from handlers, table reads from fixtures; an update returns `updated[table]`. */
function fakeDb(rpcs: Record<string, RpcHandler>, tables: Record<string, unknown[]> = {}, updated: Record<string, unknown[]> = {}) {
  const calls: Array<{ rpc: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ rpc: name, args });
      const handler = rpcs[name];
      if (!handler) return { data: null, error: { message: `no rpc ${name}` } };
      return { data: handler(args), error: null };
    }),
    from(table: string) {
      const chain = {
        _update: false,
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        lt: () => chain,
        gte: () => chain,
        or: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        update() {
          chain._update = true;
          return chain;
        },
        maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: chain._update ? (updated[table] ?? []) : (tables[table] ?? []), error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}

const ok = <T,>(value: T): RazorpayResult<T> => ({ kind: "ok", value });
const capturedOnOrder = { id: "pay_ORD1", amount: 25000, currency: "INR", status: "captured", captured: true, order_id: "order_OURS1", method: "upi", created_at: 1793180000 };

function fakeClient(overrides: Partial<Record<keyof RazorpayClient, unknown>> = {}) {
  return {
    mode: "live",
    createOrder: vi.fn(async () => ok({ id: "order_NEW1", amount: 25000 })),
    fetchOrderPayments: vi.fn(async () => ok([])),
    fetchPayment: vi.fn(async () => ok(capturedOnOrder)),
    fetchPaymentLinkByPayment: vi.fn(async () => ok(null)),
    fetchPaymentLink: vi.fn(async () => ok(null)),
    ...overrides,
  } as unknown as RazorpayClient;
}

const opened = { ok: true, order: { id: "o-1", public_ref: "ref_aaaaaaaaaaaaaaaaaaaaaa", provider_receipt: "vp1_o_abc", amount_paise: 25000 } };
const lines = [{ index: 0, amount_rupees: 100 }, { index: 1, amount_rupees: 150 }];

describe("opening a checkout order", () => {
  it("opens in the database, then at Razorpay, and records Razorpay's id", async () => {
    const db = fakeDb({ online_payment_open_order: () => opened, online_payment_order_recorded: () => ({}) });
    const client = fakeClient();
    const result = await openCheckoutOrder({ supabase: db, client, sendId: "s-1", lines, autoPosting: true });
    expect(result).toEqual({ kind: "ok", providerOrderId: "order_NEW1", amountPaise: 25000, publicRef: opened.order.public_ref });
    expect(db.calls.find((call) => call.rpc === "online_payment_open_order")?.args).toMatchObject({ p_send_id: "s-1", p_lines: lines, p_provider_mode: "live" });
    // Our references only: no student detail reaches Razorpay.
    expect(client.createOrder).toHaveBeenCalledWith({ amountPaise: 25000, receipt: "vp1_o_abc", notes: { intent_ref: opened.order.public_ref, purpose: "school_fee" } });
    expect(db.calls.find((call) => call.rpc === "online_payment_order_recorded")?.args).toEqual({ p_order_id: "o-1", p_provider_order_id: "order_NEW1" });
  });

  it("fails an order Razorpay did not answer for, and asks the parent to tap again", async () => {
    const db = fakeDb({ online_payment_open_order: () => opened, online_payment_order_failed: () => null });
    const client = fakeClient({ createOrder: vi.fn(async () => ({ kind: "uncertain", reason: "timeout" })) });
    expect(await openCheckoutOrder({ supabase: db, client, sendId: "s-1", lines, autoPosting: true })).toEqual({ kind: "try_again", reason: "timeout" });
    expect(db.calls.map((call) => call.rpc)).toContain("online_payment_order_failed");
  });

  it("passes the database's refusal through, with the child it is about, and never calls Razorpay", async () => {
    const db = fakeDb({ online_payment_open_order: () => ({ ok: false, reason: "amount_out_of_range", index: 1 }) });
    const client = fakeClient();
    expect(await openCheckoutOrder({ supabase: db, client, sendId: "s-1", lines, autoPosting: true })).toEqual({ kind: "refused", reason: "amount_out_of_range", index: 1 });
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it("refuses a second order while a payment on the last one is still being authorised", async () => {
    const db = fakeDb(
      { online_payment_open_order: () => opened },
      { online_payment_orders: [{ id: "o-0", status: "open", provider_order_id: "order_OLD1", send_id: "s-1", created_at: new Date().toISOString() }] },
    );
    const client = fakeClient({ fetchOrderPayments: vi.fn(async () => ok([{ ...capturedOnOrder, status: "authorized", captured: false }])) });
    expect(await openCheckoutOrder({ supabase: db, client, sendId: "s-1", lines, autoPosting: true })).toEqual({ kind: "in_progress" });
    expect(db.calls.map((call) => call.rpc)).not.toContain("online_payment_open_order");
  });

  it("posts money already captured on the last order instead of opening another", async () => {
    const db = fakeDb(
      {
        online_payment_record_order_capture: () => ({ recorded: true, capture: { id: "c-1", application_status: "pending" } }),
        online_payment_apply_order_capture: () => ({ applied: true }),
      },
      { online_payment_orders: [{ id: "o-0", status: "open", provider_order_id: "order_OURS1", send_id: "s-1", created_at: new Date().toISOString() }] },
    );
    const client = fakeClient({ fetchOrderPayments: vi.fn(async () => ok([capturedOnOrder])) });
    expect(await openCheckoutOrder({ supabase: db, client, sendId: "s-1", lines, autoPosting: true })).toEqual({ kind: "already_paid", postedPaymentIds: ["pay_ORD1"] });
    expect(db.calls.map((call) => call.rpc)).not.toContain("online_payment_open_order");
  });
});

describe("opening an order backed by a UPI Payment Link", () => {
  const payWith: PayWith = { kind: "upi_link", upiOnly: true, callbackUrl: "https://fees.vpps.co.in/pay/CODE", description: "VPPS — school fees" };
  const upiUri = "upi://pay?pa=vpps.rzp@icici&pn=VPPS&tr=TxnRef123&am=250.00&cu=INR&mc=8211";
  // As Razorpay behaves (probed live 2026-10-30): the create's reply has no
  // order, and the link has one only once its hosted page has been read.
  const linkClient = (overrides: Partial<Record<keyof RazorpayClient, unknown>> = {}) => {
    let pageRead = false;
    return fakeClient({
      createPaymentLink: vi.fn(async () => ok({ id: "plink_1", short_url: "https://rzp.io/rzp/abc", status: "created" })),
      fetchUpiIntentUri: vi.fn(async () => {
        pageRead = true;
        return upiUri;
      }),
      fetchPaymentLink: vi.fn(async () => ok({ id: "plink_1", order_id: pageRead ? "order_LINK1" : null })),
      cancelPaymentLink: vi.fn(async () => ok({ id: "plink_1", status: "cancelled" })),
      fetchPaymentLinkByReference: vi.fn(async () => ok(null)),
      ...overrides,
    });
  };
  const recordingDb = () =>
    fakeDb({ online_payment_open_order: () => opened, online_payment_order_recorded: () => ({}), online_payment_order_failed: () => null });

  it("opens a UPI link for the total, makes the link's own order ours, and hands back the app link", async () => {
    const db = recordingDb();
    const client = linkClient();
    const result = await openCheckoutOrder({ supabase: db, client, sendId: "s-1", lines, autoPosting: true, payWith });
    expect(result).toEqual({
      kind: "ok",
      providerOrderId: "order_LINK1",
      amountPaise: 25000,
      publicRef: opened.order.public_ref,
      link: { shortUrl: "https://rzp.io/rzp/abc", upiUri, replaced: [] },
    });
    // Our references only, the order's receipt as the link's reference, and UPI only.
    expect(client.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        amountPaise: 25000,
        referenceId: "vp1_o_abc",
        upiOnly: true,
        callbackUrl: "https://fees.vpps.co.in/pay/CODE",
        notes: { intent_ref: opened.order.public_ref, purpose: "school_fee" },
      }),
    );
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(db.calls.find((call) => call.rpc === "online_payment_order_recorded")?.args).toEqual({ p_order_id: "o-1", p_provider_order_id: "order_LINK1" });
  });

  it("reads the link's page before asking for its order, because that read is what opens the order", async () => {
    const client = linkClient();
    await openCheckoutOrder({ supabase: recordingDb(), client, sendId: "s-1", lines, autoPosting: true, payWith });
    const pageRead = vi.mocked(client.fetchUpiIntentUri).mock.invocationCallOrder[0];
    const orderAsked = vi.mocked(client.fetchPaymentLink).mock.invocationCallOrder[0];
    expect(pageRead).toBeLessThan(orderAsked);
    // One read was enough: no second trip to Razorpay's page.
    expect(client.fetchUpiIntentUri).toHaveBeenCalledTimes(1);
  });

  it("reads the page once more when a slow first read left the order missing", async () => {
    let reads = 0;
    const client = linkClient({
      fetchUpiIntentUri: vi.fn(async () => {
        reads += 1;
        return reads === 1 ? null : upiUri;
      }),
      fetchPaymentLink: vi.fn(async () => ok({ id: "plink_1", order_id: reads >= 2 ? "order_LINK2" : null })),
    });
    const result = await openCheckoutOrder({ supabase: recordingDb(), client, sendId: "s-1", lines, autoPosting: true, payWith });
    expect(result).toMatchObject({ kind: "ok", providerOrderId: "order_LINK2", link: { upiUri } });
    expect(client.fetchUpiIntentUri).toHaveBeenCalledTimes(2);
  });

  it("uses an order Razorpay's reply already names, without asking again", async () => {
    const client = linkClient({
      createPaymentLink: vi.fn(async () => ok({ id: "plink_1", order_id: "order_LINK3", short_url: "https://rzp.io/rzp/abc", status: "created" })),
    });
    const result = await openCheckoutOrder({ supabase: recordingDb(), client, sendId: "s-1", lines, autoPosting: true, payWith });
    expect(result).toMatchObject({ kind: "ok", providerOrderId: "order_LINK3" });
    expect(client.fetchPaymentLink).not.toHaveBeenCalled();
  });

  it("never offers a link it could not tie to an order: cancels it and asks the parent to tap again", async () => {
    const db = recordingDb();
    const client = linkClient({
      fetchPaymentLink: vi.fn(async () => ok({ id: "plink_1", order_id: null })),
    });
    expect(await openCheckoutOrder({ supabase: db, client, sendId: "s-1", lines, autoPosting: true, payWith })).toEqual({ kind: "try_again", reason: "link_without_order" });
    expect(client.cancelPaymentLink).toHaveBeenCalledWith("plink_1");
    expect(db.calls.map((call) => call.rpc)).toContain("online_payment_order_failed");
    expect(db.calls.map((call) => call.rpc)).not.toContain("online_payment_order_recorded");
  });

  it("finds and cancels a link whose creation Razorpay never answered, by our reference", async () => {
    const db = recordingDb();
    const client = linkClient({
      createPaymentLink: vi.fn(async () => ({ kind: "uncertain", reason: "timeout" })),
      fetchPaymentLinkByReference: vi.fn(async () => ok({ id: "plink_lost", status: "created" })),
    });
    expect(await openCheckoutOrder({ supabase: db, client, sendId: "s-1", lines, autoPosting: true, payWith })).toEqual({ kind: "try_again", reason: "timeout" });
    expect(client.fetchPaymentLinkByReference).toHaveBeenCalledWith("vp1_o_abc");
    expect(client.cancelPaymentLink).toHaveBeenCalledWith("plink_lost");
    expect(db.calls.map((call) => call.rpc)).toContain("online_payment_order_failed");
  });

  it("does not show a UPI address that is not exactly this payment", async () => {
    const client = linkClient({
      fetchUpiIntentUri: vi.fn(async () => upiUri.replace("am=250.00", "am=999.00")),
      fetchPaymentLink: vi.fn(async () => ok({ id: "plink_1", order_id: "order_LINK1" })),
    });
    const result = await openCheckoutOrder({ supabase: recordingDb(), client, sendId: "s-1", lines, autoPosting: true, payWith });
    expect(result).toMatchObject({ kind: "ok", link: { upiUri: null, shortUrl: "https://rzp.io/rzp/abc" } });
  });

  it("hands back the earlier links this tap supersedes, so they stop being payable", async () => {
    const db = fakeDb(
      { online_payment_open_order: () => opened, online_payment_order_recorded: () => ({}) },
      {
        online_payment_orders: [
          { id: "o-0", status: "open", provider_order_id: "order_OLD1", provider_receipt: "vp1_o_old", send_id: "s-1", created_at: new Date().toISOString() },
        ],
      },
    );
    const result = await openCheckoutOrder({ supabase: db, client: linkClient(), sendId: "s-1", lines, autoPosting: true, payWith });
    expect(result).toMatchObject({ kind: "ok", link: { replaced: ["vp1_o_old"] } });
  });

  it("cancels only links that are still unpaid", async () => {
    const client = linkClient({
      fetchPaymentLinkByReference: vi.fn(async (reference: string) =>
        ok(reference === "vp1_o_a" ? { id: "plink_a", status: "created" } : { id: "plink_b", status: "paid" }),
      ),
    });
    await cancelLinksByReference(client, ["vp1_o_a", "vp1_o_b"]);
    expect(client.cancelPaymentLink).toHaveBeenCalledTimes(1);
    expect(client.cancelPaymentLink).toHaveBeenCalledWith("plink_a");
  });
});

describe("a payment fetched from Razorpay", () => {
  it("on an order of ours is recorded against the order and posted", async () => {
    const db = fakeDb(
      {
        online_payment_record_order_capture: () => ({ recorded: true, capture: { id: "c-1", application_status: "pending" } }),
        online_payment_apply_order_capture: () => ({ applied: true }),
      },
      { online_payment_orders: [{ id: "o-1" }] },
    );
    expect(await processOrderPayment({ supabase: db, client: fakeClient(), payment: capturedOnOrder, autoPosting: true })).toBe("applied");
    expect(db.calls.find((call) => call.rpc === "online_payment_record_order_capture")?.args.p_facts).toMatchObject({ provider_order_id: "order_OURS1", amount_paise: 25000 });
  });

  it("on an order that is not ours is left for the Payment Link path", async () => {
    const db = fakeDb({}, { online_payment_orders: [] });
    expect(await processOrderPayment({ supabase: db, client: fakeClient(), payment: capturedOnOrder, autoPosting: true })).toBeNull();
  });

  it("takes the order path before any Payment Link lookup", async () => {
    const db = fakeDb(
      {
        online_payment_record_order_capture: () => ({ recorded: true, capture: { id: "c-1", application_status: "pending" } }),
        online_payment_apply_order_capture: () => ({ applied: true }),
      },
      { online_payment_orders: [{ id: "o-1" }] },
    );
    const client = fakeClient();
    expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_ORD1", autoPosting: true })).toBe("applied");
    expect(client.fetchPaymentLinkByPayment).not.toHaveBeenCalled();
  });

  it("an order capture is posted by the order function, never the Payment Link one", async () => {
    const db = fakeDb(
      { online_payment_apply_order_capture: () => ({ applied: true }), online_payment_apply_capture: () => ({ applied: true }) },
      { online_payment_captures: [{ order_id: "o-1" }] },
    );
    expect(await applyCapture(db, "c-1", "reconciler")).toBe("applied");
    expect(db.calls.map((call) => call.rpc)).toEqual(["online_payment_apply_order_capture"]);
  });
});

describe("the page's poll", () => {
  it("asks Razorpay at most once every few seconds per order", async () => {
    const db = fakeDb({}, { online_payment_orders: [{ id: "o-1", status: "open", provider_order_id: "order_OURS1", send_id: "s-1", created_at: new Date().toISOString() }] }, { online_payment_orders: [] });
    const client = fakeClient();
    const result = await refreshOrderStatus({ supabase: db, client, sendId: "s-1", autoPosting: true });
    expect(client.fetchOrderPayments).not.toHaveBeenCalled();
    expect(result.status).toEqual({ state: "waiting" });
  });

  it("posts a capture the handler never reported, and says received", async () => {
    const db = fakeDb(
      {
        online_payment_record_order_capture: () => ({ recorded: true, capture: { id: "c-1", application_status: "pending" } }),
        online_payment_apply_order_capture: () => ({ applied: true }),
      },
      { online_payment_orders: [{ id: "o-1", status: "open", provider_order_id: "order_OURS1", send_id: "s-1", created_at: new Date().toISOString() }] },
      { online_payment_orders: [{ id: "o-1" }] },
    );
    const client = fakeClient({ fetchOrderPayments: vi.fn(async () => ok([capturedOnOrder])) });
    const result = await refreshOrderStatus({ supabase: db, client, sendId: "s-1", autoPosting: true });
    expect(result.postedPaymentIds).toEqual(["pay_ORD1"]);
  });

  const polledOrder = () =>
    fakeDb(
      {},
      { online_payment_orders: [{ id: "o-1", status: "open", provider_order_id: "order_OURS1", send_id: "s-1", created_at: new Date().toISOString() }] },
      { online_payment_orders: [{ id: "o-1" }] },
    );

  it("says 'failed' when every attempt was declined and nothing was taken, so the page offers a retry", async () => {
    const client = fakeClient({
      fetchOrderPayments: vi.fn(async () => ok([{ ...capturedOnOrder, id: "pay_F1", status: "failed", captured: false }])),
    });
    const result = await refreshOrderStatus({ supabase: polledOrder(), client, sendId: "s-1", autoPosting: true });
    expect(result).toEqual({ status: { state: "failed" }, postedPaymentIds: [] });
  });

  it("does not call it failed while another attempt on the order is still going", async () => {
    const client = fakeClient({
      fetchOrderPayments: vi.fn(async () =>
        ok([
          { ...capturedOnOrder, id: "pay_F1", status: "failed", captured: false },
          { ...capturedOnOrder, id: "pay_F2", status: "created", captured: false },
        ]),
      ),
    });
    const result = await refreshOrderStatus({ supabase: polledOrder(), client, sendId: "s-1", autoPosting: true });
    expect(result.status.state).not.toBe("failed");
  });
});
