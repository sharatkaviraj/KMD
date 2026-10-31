import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { applyOrderCapture, processOrderPayment, reconcileOpenOrders } from "@/modules/payments/data/online/orders";
import type { RazorpayClient, RazorpayResult } from "@/modules/payments/data/online/razorpay-client";
import {
  applyCapture,
  processInboxEvent,
  processProviderPayment,
  reconcileOnlinePayments,
} from "@/modules/payments/data/online/service";
import {
  FEES_APP_REFERENCE_PREFIX,
  REFERENCE_PREFIX,
  checkFetchedCapture,
  isFeesAppReference,
} from "@/modules/payments/domain/online/capture-check";

/**
 * The two apps never process each other's payments (go-live Phase E, plan
 * §7.3, critique0 #2).
 *
 * Razorpay sends every event on the school's one account to every registered
 * webhook. The fees app owns `vpps_…` links and `vpps_o_…` orders; One mints
 * `vp1_…` and `vp1_o_…`. The Payment Link path checked the prefix already —
 * the order path matched on `provider_order_id` alone, so a fees order brought
 * in by the data load would have been posted by One as well as by the fees
 * app. These pin the refusal on every path that could post: the webhook's
 * payment, the order reconciler, the link reconciler, and "post now".
 */

type RpcHandler = (args: Record<string, unknown>) => unknown;

function fakeDb(rpcs: Record<string, RpcHandler>, tables: Record<string, unknown[]> = {}) {
  const calls: Array<{ rpc: string; args: Record<string, unknown> }> = [];
  const nots: Array<{ table: string; column: string; op: string; value: string }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  return {
    calls,
    nots,
    updates,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ rpc: name, args });
      const handler = rpcs[name];
      if (!handler) return { data: null, error: { message: `no rpc ${name}` } };
      return { data: handler(args), error: null };
    }),
    from(table: string) {
      const chain = {
        _update: null as Record<string, unknown> | null,
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        lt: () => chain,
        gte: () => chain,
        or: () => chain,
        not(column: string, op: string, value: string) {
          nots.push({ table, column, op, value });
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        update(values: Record<string, unknown>) {
          chain._update = values;
          updates.push({ table, values });
          return chain;
        },
        maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: chain._update ? [] : (tables[table] ?? []), error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}

const ok = <T,>(value: T): RazorpayResult<T> => ({ kind: "ok", value });

/** A captured payment on the fees app's checkout order `order_FEES1`. */
const feesOrderPayment = {
  id: "pay_FEES1",
  amount: 250000,
  currency: "INR",
  status: "captured",
  captured: true,
  order_id: "order_FEES1",
  method: "upi",
  created_at: 1793180000,
};

function fakeClient(overrides: Partial<Record<keyof RazorpayClient, unknown>> = {}) {
  return {
    mode: "live",
    fetchPayment: vi.fn(async () => ok(feesOrderPayment)),
    fetchOrderPayments: vi.fn(async () => ok([feesOrderPayment])),
    fetchPaymentLinkByPayment: vi.fn(async () => ok(null)),
    fetchPaymentLink: vi.fn(async () => ok(null)),
    cancelPaymentLink: vi.fn(async () => ok({})),
    ...overrides,
  } as unknown as RazorpayClient;
}

/** The fees order as the importer leaves it: terminal, with the fees app's receipt. */
const importedFeesOrder = {
  id: "o-fees",
  status: "abandoned",
  provider_order_id: "order_FEES1",
  provider_receipt: "vpps_o_0123456789abcdef0123456789abcdef",
  send_id: "s-fees",
  amount_paise: 250000,
  created_at: new Date().toISOString(),
};

const POSTING_RPCS = [
  "online_payment_record_order_capture",
  "online_payment_apply_order_capture",
  "online_payment_record_capture",
  "online_payment_apply_capture",
];

describe("the prefixes", () => {
  it("One mints vp1_, the fees app vpps_, and neither reads as the other", () => {
    expect(REFERENCE_PREFIX).toBe("vp1_");
    expect(FEES_APP_REFERENCE_PREFIX).toBe("vpps_");
    expect(isFeesAppReference("vpps_0123")).toBe(true);
    expect(isFeesAppReference("vpps_o_0123")).toBe(true);
    expect(isFeesAppReference("vp1_0123")).toBe(false);
    expect(isFeesAppReference("vp1_o_0123")).toBe(false);
    expect(isFeesAppReference(null)).toBe(false);
    // The fees app's own check is `startsWith("vpps_")`: a One reference fails it.
    expect("vp1_o_0123".startsWith("vpps_")).toBe(false);
  });

  it("a payment on a fees app Payment Link is not our link", () => {
    const payment = { id: "pay_1", amount: 5000, currency: "INR", status: "captured", captured: true, order_id: "order_1" };
    const link = { id: "plink_1", reference_id: "vpps_abc", order_id: "order_1", payments: [{ payment_id: "pay_1" }] };
    expect(checkFetchedCapture({ payment, link, mode: "live", intentRefMatched: true })).toEqual({ ok: false, reason: "not_our_link" });
    expect(checkFetchedCapture({ payment, link: { ...link, reference_id: "vp1_abc" }, mode: "live" })).toMatchObject({ ok: true });
  });
});

describe("a fees app order_* payment arriving after its order was imported", () => {
  it("is not_ours at One's webhook, and nothing is recorded or posted", async () => {
    const db = fakeDb({}, { online_payment_orders: [importedFeesOrder] });
    const client = fakeClient();
    const outcome = await processProviderPayment({ supabase: db, client, paymentId: "pay_FEES1", autoPosting: true });
    expect(outcome).toBe("not_ours");
    expect(db.calls.map((call) => call.rpc).filter((rpc) => POSTING_RPCS.includes(rpc))).toEqual([]);
  });

  it("leaves the inbox row ignored, not processed and not pending", async () => {
    const db = fakeDb({}, { online_payment_orders: [importedFeesOrder] });
    const outcome = await processInboxEvent({
      supabase: db,
      client: fakeClient(),
      event: { id: "e1", event_type: "payment.captured", provider_payment_id: "pay_FEES1", provider_link_id: null, attempts: 0 },
      switches: { links: true, autoPosting: true, receipts: true },
    });
    expect(outcome).toBe("not_ours");
    expect(db.updates.find((update) => update.table === "online_payment_events")?.values).toMatchObject({ status: "ignored" });
  });

  it("is refused on the order path even if the order were still open", async () => {
    const db = fakeDb({}, { online_payment_orders: [{ ...importedFeesOrder, status: "open" }] });
    expect(await processOrderPayment({ supabase: db, client: fakeClient(), payment: feesOrderPayment, autoPosting: true })).toBe("not_ours");
    expect(db.calls).toEqual([]);
  });

  it("One's own order still records and posts", async () => {
    const db = fakeDb(
      {
        online_payment_record_order_capture: () => ({ recorded: true, capture: { id: "c-1", application_status: "pending" } }),
        online_payment_apply_order_capture: () => ({ applied: true }),
      },
      { online_payment_orders: [{ ...importedFeesOrder, status: "open", provider_receipt: "vp1_o_0123456789abcdef0123456789abcdef" }] },
    );
    expect(await processOrderPayment({ supabase: db, client: fakeClient(), payment: feesOrderPayment, autoPosting: true })).toBe("applied");
  });
});

describe("the reconcilers leave the fees app's rows alone", () => {
  it("asks the database for no vpps_ order, and skips one that comes back anyway", async () => {
    const db = fakeDb({ online_payment_order_failed: () => null }, { online_payment_orders: [{ ...importedFeesOrder, status: "pending" }] });
    const client = fakeClient();
    const result = await reconcileOpenOrders({ supabase: db, client, autoPosting: true });
    expect(db.nots.filter((not) => not.table === "online_payment_orders")).toEqual([
      { table: "online_payment_orders", column: "provider_receipt", op: "like", value: "vpps_%" },
      { table: "online_payment_orders", column: "provider_receipt", op: "like", value: "vpps_%" },
    ]);
    expect(db.calls.map((call) => call.rpc)).not.toContain("online_payment_order_failed");
    expect(client.fetchOrderPayments).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, posted: [] });
  });

  it("the link pass never asks about, cancels or closes a vpps_ link", async () => {
    const db = fakeDb(
      { notification_outbox_claim: () => [] },
      {
        app_settings: [],
        online_payment_events: [],
        online_payment_orders: [],
        online_payment_intents: [
          { id: "i-fees", status: "superseded", provider_reference_id: "vpps_1", provider_link_id: "plink_fees", provider_cancelled_at: null, link_attempts: 1, updated_at: "2026-10-28T00:00:00Z" },
        ],
      },
    );
    const client = fakeClient();
    const report = await reconcileOnlinePayments({ supabase: db, client, sendReceipt: vi.fn() });
    expect(db.nots).toContainEqual({ table: "online_payment_intents", column: "provider_reference_id", op: "like", value: "vpps_%" });
    expect(client.fetchPaymentLink).not.toHaveBeenCalled();
    expect(client.cancelPaymentLink).not.toHaveBeenCalled();
    expect(report.linksChecked).toBe(0);
  });
});

describe("posting a recorded capture by hand", () => {
  it("refuses a capture on a fees app link before the database is asked", async () => {
    const db = fakeDb({ online_payment_apply_capture: () => ({ applied: true }) }, {
      online_payment_captures: [{ order_id: null, online_payment_intents: { provider_reference_id: "vpps_1" } }],
    });
    expect(await applyCapture(db, "c-1", "staff:x")).toBe("not_ours");
    expect(db.calls).toEqual([]);
  });

  it("refuses a capture on a fees app order before the database is asked", async () => {
    const db = fakeDb({ online_payment_apply_order_capture: () => ({ applied: true }) }, {
      online_payment_captures: [{ online_payment_orders: { provider_receipt: "vpps_o_1" } }],
    });
    expect(await applyOrderCapture(db, "c-1", "staff:x")).toBe("not_ours");
    expect(db.calls).toEqual([]);
  });

  it("reads the database's own not_ours refusal as not_ours", async () => {
    const db = fakeDb({ online_payment_apply_capture: () => ({ applied: false, status: "not_ours" }) }, {
      online_payment_captures: [{ order_id: null, online_payment_intents: { provider_reference_id: "vp1_1" } }],
    });
    expect(await applyCapture(db, "c-1", "staff:x")).toBe("not_ours");
  });
});
