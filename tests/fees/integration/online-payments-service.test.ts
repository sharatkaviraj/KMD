import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import type { RazorpayClient, RazorpayResult } from "@/modules/payments/data/online/razorpay-client";
import {
  drainReceiptOutbox,
  ensureProviderLink,
  linkExpiry,
  processInboxEvent,
  processProviderPayment,
  reconcileOnlinePayments,
  type IntentRow,
} from "@/modules/payments/data/online/service";

/* ------------------------------------------------------------ fakes */

type RpcHandler = (args: Record<string, unknown>) => unknown;

/**
 * A database that answers RPCs from handlers and table reads from fixtures,
 * and records every write. Enough of PostgREST's chain for this module.
 */
function fakeDb(rpcs: Record<string, RpcHandler>, tables: Record<string, unknown[]> = {}) {
  const calls: Array<{ rpc: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const db = {
    calls,
    updates,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ rpc: name, args });
      const handler = rpcs[name];
      if (!handler) return { data: null, error: { message: `no rpc ${name}` } };
      const value = handler(args);
      return value instanceof Error ? { data: null, error: { message: value.message } } : { data: value, error: null };
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
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        update(values: Record<string, unknown>) {
          chain._update = values;
          updates.push({ table, values });
          return chain;
        },
        maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: chain._update ? [] : tables[table] ?? [], error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
  return db;
}

function fakeClient(overrides: Partial<Record<keyof RazorpayClient, unknown>> = {}) {
  const ok = <T,>(value: T): RazorpayResult<T> => ({ kind: "ok", value });
  return {
    mode: "test",
    createPaymentLink: vi.fn(async () => ok({ id: "plink_1", short_url: "https://rzp.io/i/1", reference_id: "vp1_1" })),
    fetchPaymentLink: vi.fn(async () => ok({ id: "plink_1", status: "created", reference_id: "vp1_1", payments: null })),
    fetchPaymentLinkByReference: vi.fn(async () => ok(null)),
    fetchPaymentLinkByPayment: vi.fn(async () => ok({ id: "plink_1", reference_id: "vp1_1", order_id: "order_1", payments: [{ payment_id: "pay_1", status: "captured" }] })),
    cancelPaymentLink: vi.fn(async () => ok({ id: "plink_1", status: "cancelled" })),
    fetchPayment: vi.fn(async () => ok({ id: "pay_1", amount: 800000, currency: "INR", status: "captured", captured: true, order_id: "order_1", method: "upi", created_at: 1793180000 })),
    ...overrides,
  } as unknown as RazorpayClient;
}

const intent = (over: Partial<IntentRow> = {}): IntentRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  public_ref: "ref_aaaaaaaaaaaaaaaaaaaaaa",
  status: "link_pending",
  student_id: "398ae781-5149-4f99-9eca-92d7bf31b1bf",
  amount_rupees: 8000,
  amount_paise: 800000,
  expires_at: "2026-11-01T18:29:00.000Z",
  provider_mode: "test",
  provider_reference_id: "vp1_1",
  provider_link_id: null,
  provider_short_url: null,
  link_attempts: 0,
  receipt_id: null,
  ...over,
});

const linkArgs = { callbackUrl: "https://example.test/pay/c?returned=1", schoolName: "VPPS" };

/* ------------------------------------------------------------ links */

describe("making a provider link safe to retry", () => {
  it("an uncertain create is NOT a failure: the intent stays pending and nothing else is created", async () => {
    const db = fakeDb({ online_payment_link_failed: () => null });
    const client = fakeClient({ createPaymentLink: vi.fn(async () => ({ kind: "uncertain", reason: "timeout" })) });
    const outcome = await ensureProviderLink({ supabase: db, client, intent: intent(), ...linkArgs });
    expect(outcome).toEqual({ kind: "uncertain", reason: "timeout" });
    expect(db.calls).toContainEqual({ rpc: "online_payment_link_failed", args: expect.objectContaining({ p_definite: false }) });
  });

  it("after an uncertain attempt, the link is LOOKED UP by reference before any create", async () => {
    const db = fakeDb({ online_payment_link_recorded: () => ({}) });
    const client = fakeClient({
      fetchPaymentLinkByReference: vi.fn(async () => ({ kind: "ok", value: { id: "plink_9", short_url: "https://rzp.io/i/9", reference_id: "vp1_1" } })),
    });
    const outcome = await ensureProviderLink({ supabase: db, client, intent: intent({ link_attempts: 1 }), ...linkArgs });
    expect(outcome).toEqual({ kind: "ok", url: "https://rzp.io/i/9" });
    expect(client.createPaymentLink).not.toHaveBeenCalled();
  });

  it("a second phone that loses the race to create gets the same link back", async () => {
    const db = fakeDb({ online_payment_link_recorded: () => ({}) });
    const client = fakeClient({
      createPaymentLink: vi.fn(async () => ({ kind: "refused", status: 400, code: "BAD_REQUEST_ERROR", description: "payment link creation with reference ID already attempted" })),
      fetchPaymentLinkByReference: vi.fn(async () => ({ kind: "ok", value: { id: "plink_1", short_url: "https://rzp.io/i/1", reference_id: "vp1_1" } })),
    });
    const outcome = await ensureProviderLink({ supabase: db, client, intent: intent(), ...linkArgs });
    expect(outcome).toEqual({ kind: "ok", url: "https://rzp.io/i/1" });
  });

  it("a definite refusal frees the student's slot", async () => {
    const db = fakeDb({ online_payment_link_failed: () => null });
    const client = fakeClient({ createPaymentLink: vi.fn(async () => ({ kind: "refused", status: 400, code: "BAD_REQUEST_ERROR", description: "amount too small" })) });
    expect(await ensureProviderLink({ supabase: db, client, intent: intent(), ...linkArgs })).toEqual({ kind: "refused" });
    expect(db.calls).toContainEqual({ rpc: "online_payment_link_failed", args: expect.objectContaining({ p_definite: true }) });
  });

  it("sends no student detail to the provider page", async () => {
    const db = fakeDb({ online_payment_link_recorded: () => ({}) });
    const client = fakeClient();
    await ensureProviderLink({ supabase: db, client, intent: intent(), ...linkArgs });
    const sent = JSON.stringify((client.createPaymentLink as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(sent).not.toContain("398ae781");
    expect(sent).toContain('"amountPaise":800000');
  });

  it("a live key gets a UPI-only link unless the setting turns it off; a test key never does", async () => {
    const upiOnlyFor = async (mode: "live" | "test", tables: Record<string, unknown[]> = {}) => {
      const db = fakeDb({ online_payment_link_recorded: () => ({}) }, tables);
      const client = fakeClient({ mode });
      await ensureProviderLink({ supabase: db, client, intent: intent(), ...linkArgs });
      return (client.createPaymentLink as ReturnType<typeof vi.fn>).mock.calls[0][0].upiOnly;
    };
    expect(await upiOnlyFor("live")).toBe(true);
    expect(await upiOnlyFor("live", { app_settings: [{ value: "false" }] })).toBe(false);
    expect(await upiOnlyFor("test")).toBe(false);
  });

  it("expires at the end of the notice day in India, never inside Razorpay's 15-minute floor", () => {
    const now = new Date("2026-10-28T10:00:00Z");
    expect(linkExpiry("2026-11-05", now).toISOString()).toBe("2026-11-05T18:29:00.000Z");
    expect(linkExpiry("2026-10-28", new Date("2026-10-28T18:20:00Z")).getTime()).toBe(new Date("2026-10-28T18:40:00Z").getTime());
    expect(linkExpiry(null, now).getTime() - now.getTime()).toBe(7 * 24 * 3600 * 1000);
  });
});

/* ------------------------------------------------------------ captures */

describe("verifying and posting a payment", () => {
  const recorded = (status = "pending") => ({ recorded: true, duplicate: false, capture: { id: "cap_1", application_status: status } });

  it("records captured money using the API's amount, and posts when automatic posting is on", async () => {
    const db = fakeDb({ online_payment_record_capture: () => recorded(), online_payment_apply_capture: () => ({ applied: true }) });
    const outcome = await processProviderPayment({ supabase: db, client: fakeClient(), paymentId: "pay_1", autoPosting: true });
    expect(outcome).toBe("applied");
    const facts = db.calls.find((call) => call.rpc === "online_payment_record_capture")?.args.p_facts as Record<string, unknown>;
    expect(facts).toMatchObject({ amount_paise: 800000, provider_mode: "test", provider_link_id: "plink_1", reference_id: "vp1_1" });
  });

  it("with automatic posting off, money is recorded and waits for a person", async () => {
    const db = fakeDb({ online_payment_record_capture: () => recorded() });
    expect(await processProviderPayment({ supabase: db, client: fakeClient(), paymentId: "pay_1", autoPosting: false })).toBe("recorded");
    expect(db.calls.map((call) => call.rpc)).not.toContain("online_payment_apply_capture");
  });

  it("authorised-only money is not recorded at all", async () => {
    const db = fakeDb({});
    const client = fakeClient({ fetchPayment: vi.fn(async () => ({ kind: "ok", value: { id: "pay_1", amount: 800000, currency: "INR", status: "authorized", captured: false } })) });
    expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_1", autoPosting: true })).toBe("waiting_for_capture");
    expect(db.calls).toHaveLength(0);
  });

  it("a payment the school's key cannot see (the other mode, another merchant) is not ours", async () => {
    const db = fakeDb({});
    const client = fakeClient({ fetchPayment: vi.fn(async () => ({ kind: "refused", status: 400, code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" })) });
    expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_x", autoPosting: true })).toBe("not_ours");
    expect(db.calls).toHaveLength(0);
  });

  it("a provider outage is retried later, never guessed", async () => {
    const db = fakeDb({});
    const client = fakeClient({ fetchPayment: vi.fn(async () => ({ kind: "uncertain", reason: "http_503" })) });
    expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_1", autoPosting: true })).toBe("retry");
  });

  describe("a UPI Payment Link, whose payment `payment_links?payment_id=` does not find", () => {
    // What production saw for the first live UPI link (₹50, 2026-10-29): the
    // lookup by payment came back empty, so captured money was ignored as
    // "not ours" while the signed `payment_link.paid` named our own link.
    const upiPayment = { id: "pay_1", amount: 5000, currency: "INR", status: "captured", captured: true, order_id: "order_upi", method: "upi", created_at: 1793258959 };
    const ourLink = (over: Record<string, unknown> = {}) => ({ id: "plink_upi", reference_id: "vp1_1", order_id: "order_upi", status: "paid", payments: null, ...over });
    const upiClient = (link: Record<string, unknown>) =>
      fakeClient({
        fetchPayment: vi.fn(async () => ({ kind: "ok", value: upiPayment })),
        fetchPaymentLinkByPayment: vi.fn(async () => ({ kind: "ok", value: null })),
        fetchPaymentLink: vi.fn(async () => ({ kind: "ok", value: link })),
      });

    it("is recorded and posted when our link, fetched by id, carries the payment's order", async () => {
      const db = fakeDb({ online_payment_record_capture: () => recorded(), online_payment_apply_capture: () => ({ applied: true }) });
      const outcome = await processProviderPayment({ supabase: db, client: upiClient(ourLink()), paymentId: "pay_1", autoPosting: true, linkId: "plink_upi" });
      expect(outcome).toBe("applied");
      const facts = db.calls.find((call) => call.rpc === "online_payment_record_capture")?.args.p_facts as Record<string, unknown>;
      expect(facts).toMatchObject({ provider_link_id: "plink_upi", reference_id: "vp1_1", amount_paise: 5000, method: "upi" });
    });

    it("is recorded when our link lists the payment, even without an order on either", async () => {
      const db = fakeDb({ online_payment_record_capture: () => recorded() });
      const client = upiClient(ourLink({ order_id: null, payments: [{ payment_id: "pay_1", status: "captured" }] }));
      expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_1", autoPosting: false, linkId: "plink_upi" })).toBe("recorded");
    });

    it("is refused when the hinted link names neither the payment nor its order", async () => {
      const db = fakeDb({});
      const client = upiClient(ourLink({ order_id: "order_other", payments: [{ payment_id: "pay_other" }] }));
      expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_1", autoPosting: true, linkId: "plink_upi" })).toBe("not_ours");
      expect(db.calls).toHaveLength(0);
    });

    it("is still not ours with no link to ask about", async () => {
      const db = fakeDb({});
      expect(await processProviderPayment({ supabase: db, client: upiClient(ourLink()), paymentId: "pay_1", autoPosting: true })).toBe("not_ours");
    });

    // The real shape, as production showed it: the link fetched by id lists no
    // payment and carries another order; only the payment's notes tie it.
    const qrPayment = { ...upiPayment, order_id: "order_qr", notes: { intent_ref: "x4tFprD69f96RPiqEdwVm4MG", purpose: "school_fee" } };
    const qrClient = (link: Record<string, unknown>) =>
      fakeClient({
        fetchPayment: vi.fn(async () => ({ kind: "ok", value: qrPayment })),
        fetchPaymentLinkByPayment: vi.fn(async () => ({ kind: "ok", value: null })),
        fetchPaymentLink: vi.fn(async () => ({ kind: "ok", value: link })),
      });
    const intents = (linkId: string) => ({ online_payment_intents: [{ provider_link_id: linkId }] });

    it("is posted when its intent_ref names the intent that holds the link, with no event hint at all", async () => {
      const db = fakeDb({ online_payment_record_capture: () => recorded(), online_payment_apply_capture: () => ({ applied: true }) }, intents("plink_upi"));
      const client = qrClient(ourLink({ order_id: "order_link", payments: [] }));
      expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_1", autoPosting: true })).toBe("applied");
      expect(client.fetchPaymentLink).toHaveBeenCalledWith("plink_upi");
    });

    it("is refused when its intent_ref belongs to a different link than the one fetched", async () => {
      const db = fakeDb({}, intents("plink_someone_else"));
      const client = qrClient(ourLink({ id: "plink_upi", order_id: "order_link", payments: [] }));
      expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_1", autoPosting: true, linkId: "plink_upi" })).toBe("not_ours");
      expect(db.calls).toHaveLength(0);
    });

    it("is refused when the intent_ref matches nothing of ours", async () => {
      const db = fakeDb({});
      expect(await processProviderPayment({ supabase: db, client: qrClient(ourLink({ order_id: "order_link" })), paymentId: "pay_1", autoPosting: true })).toBe("not_ours");
    });

    it("posts the exact production shape: link found by payment, same order, `payments: []`", async () => {
      // From the Vercel log of pay_TtdqnqTkrWxoWl: linkFound, both orders
      // order_TtdqbgWkGwiGci, linkListsPayments 0, reason link_does_not_list_payment.
      const db = fakeDb({ online_payment_record_capture: () => recorded(), online_payment_apply_capture: () => ({ applied: true }) });
      const client = fakeClient({
        fetchPayment: vi.fn(async () => ({ kind: "ok", value: { ...upiPayment, order_id: "order_TtdqbgWkGwiGci" } })),
        fetchPaymentLinkByPayment: vi.fn(async () => ({ kind: "ok", value: ourLink({ order_id: "order_TtdqbgWkGwiGci", payments: [] }) })),
      });
      expect(await processProviderPayment({ supabase: db, client, paymentId: "pay_1", autoPosting: true })).toBe("applied");
    });

    it("a signed payment_link.paid hands its link id to the check", async () => {
      const db = fakeDb({ online_payment_record_capture: () => recorded(), online_payment_apply_capture: () => ({ applied: true }) });
      const client = upiClient(ourLink());
      const outcome = await processInboxEvent({
        supabase: db,
        client,
        event: { id: "e1", event_type: "payment_link.paid", provider_payment_id: "pay_1", provider_link_id: "plink_upi", attempts: 0 },
        switches: { links: true, autoPosting: true, receipts: true },
      });
      expect(outcome).toBe("applied");
      expect(client.fetchPaymentLink).toHaveBeenCalledWith("plink_upi");
    });
  });

  it("a duplicate or out-of-order event for an already-posted payment posts nothing", async () => {
    const db = fakeDb({ online_payment_record_capture: () => ({ recorded: true, duplicate: true, capture: { id: "cap_1", application_status: "applied" } }) });
    expect(await processProviderPayment({ supabase: db, client: fakeClient(), paymentId: "pay_1", autoPosting: true })).toBe("duplicate");
    expect(db.calls.map((call) => call.rpc)).not.toContain("online_payment_apply_capture");
  });

  it("a refund event is recorded for the office and never acted on", async () => {
    const db = fakeDb({});
    const client = fakeClient();
    const outcome = await processInboxEvent({
      supabase: db,
      client,
      event: { id: "e1", event_type: "refund.processed", provider_payment_id: "pay_1", provider_link_id: null, attempts: 0 },
      switches: { links: true, autoPosting: true, receipts: true },
    });
    expect(outcome).toBe("ignored");
    expect(client.fetchPayment).not.toHaveBeenCalled();
  });

  it("an inbox row whose payment is only authorised stays pending for the next pass", async () => {
    const db = fakeDb({});
    const client = fakeClient({ fetchPayment: vi.fn(async () => ({ kind: "ok", value: { id: "pay_1", amount: 1, currency: "INR", status: "authorized", captured: false } })) });
    await processInboxEvent({
      supabase: db,
      client,
      event: { id: "e1", event_type: "payment.authorized", provider_payment_id: "pay_1", provider_link_id: null, attempts: 0 },
      switches: { links: true, autoPosting: true, receipts: true },
    });
    expect(db.updates[0]).toMatchObject({ table: "online_payment_events", values: { status: "pending", attempts: 1 } });
  });
});

/* ------------------------------------------------------------ reconcile */

describe("the reconciler", () => {
  const sendReceipt = vi.fn(async () => ({ outcome: "provider_accepted" as const, providerMessageId: "m1" }));

  it("cancels a still-open link for an intent the school superseded (cash at the counter)", async () => {
    const db = fakeDb(
      { online_payment_link_closed: () => null, notification_outbox_claim: () => [] },
      {
        app_settings: [],
        online_payment_events: [],
        online_payment_intents: [{ id: "i1", status: "superseded", provider_reference_id: "vp1_1", provider_link_id: "plink_1", provider_cancelled_at: null, link_attempts: 1, updated_at: "2026-10-28T00:00:00Z" }],
      },
    );
    const client = fakeClient();
    const report = await reconcileOnlinePayments({ supabase: db, client, sendReceipt });
    expect(client.cancelPaymentLink).toHaveBeenCalledWith("plink_1");
    expect(report.linksCancelled).toBe(1);
  });

  it("finds a payment the webhook never delivered, even on a link that has since expired", async () => {
    const db = fakeDb(
      {
        online_payment_link_closed: () => null,
        notification_outbox_claim: () => [],
        online_payment_record_capture: () => ({ recorded: true, capture: { id: "c1", application_status: "pending" } }),
      },
      {
        app_settings: [],
        online_payment_events: [],
        online_payment_intents: [{ id: "i1", status: "link_created", provider_reference_id: "vp1_1", provider_link_id: "plink_1", provider_cancelled_at: null, link_attempts: 1, updated_at: "2026-10-28T00:00:00Z" }],
      },
    );
    const client = fakeClient({
      fetchPaymentLink: vi.fn(async () => ({ kind: "ok", value: { id: "plink_1", status: "expired", reference_id: "vp1_1", payments: [{ payment_id: "pay_1", status: "captured" }] } })),
    });
    await reconcileOnlinePayments({ supabase: db, client, sendReceipt });
    expect(db.calls.map((call) => call.rpc)).toContain("online_payment_record_capture");
    expect(db.calls).toContainEqual({ rpc: "online_payment_link_closed", args: expect.objectContaining({ p_status: "expired" }) });
  });

  it("refreshes views, caches and staff tabs for what it posted BEFORE it sends any receipt", async () => {
    const order: string[] = [];
    const db = fakeDb(
      {
        online_payment_apply_capture: () => ({ applied: true }),
        notification_outbox_claim: () => {
          order.push("claim_outbox");
          return [];
        },
      },
      {
        app_settings: [{ key: "online_payment_auto_posting_enabled", value: "true" }],
        online_payment_events: [],
        online_payment_intents: [],
        online_payment_captures: [{ id: "c1", provider_payment_id: "pay_late1" }],
      },
    );
    const afterPosting = vi.fn(async (ids: string[]) => {
      order.push(`after_posting:${ids.join(",")}`);
    });
    const report = await reconcileOnlinePayments({ supabase: db, client: fakeClient(), sendReceipt, afterPosting });
    expect(report.capturesApplied).toBe(1);
    expect(order).toEqual(["after_posting:pay_late1", "claim_outbox"]);
  });

  it("skips the refresh when it posted nothing", async () => {
    const db = fakeDb(
      { notification_outbox_claim: () => [] },
      { app_settings: [], online_payment_events: [], online_payment_intents: [] },
    );
    const afterPosting = vi.fn();
    await reconcileOnlinePayments({ supabase: db, client: fakeClient(), sendReceipt, afterPosting });
    expect(afterPosting).not.toHaveBeenCalled();
  });

  it("stops inside its time budget rather than outliving the function", async () => {
    let clock = 0;
    const db = fakeDb(
      { notification_outbox_claim: () => [] },
      {
        app_settings: [],
        online_payment_events: Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, event_type: "payment.captured", provider_payment_id: null, provider_link_id: null, attempts: 0 })),
        online_payment_intents: [],
      },
    );
    const report = await reconcileOnlinePayments({ supabase: db, client: fakeClient(), sendReceipt, budgetMs: 10, now: () => (clock += 6) });
    expect(report.stoppedEarly).toBe(true);
  });
});

/* ------------------------------------------------------------ outbox */

describe("the receipt outbox", () => {
  const job = (over = {}) => ({ id: "j1", receipt_id: "r1", student_id: "s1", session_label: "TEST-2026-27", attempts: 1, max_attempts: 5, payload: { receipt_number: "SVP20260401-0001", amount: 8000, payment_date: "2026-04-01" }, ...over });

  it("with receipt delivery switched off, a job is suppressed, not sent", async () => {
    const db = fakeDb({ notification_outbox_claim: () => [job()], notification_outbox_complete: () => null });
    const sendReceipt = vi.fn();
    await drainReceiptOutbox({ supabase: db, sendReceipt, switches: { links: true, autoPosting: true, receipts: false } });
    expect(sendReceipt).not.toHaveBeenCalled();
    expect(db.calls).toContainEqual({ rpc: "notification_outbox_complete", args: expect.objectContaining({ p_status: "suppressed" }) });
  });

  it("an UNCERTAIN send is never retried automatically — it is shown to the office", async () => {
    const db = fakeDb({ notification_outbox_claim: () => [job()], notification_outbox_complete: () => null });
    const sendReceipt = vi.fn(async () => ({ outcome: "uncertain" as const, reason: "no answer" }));
    await drainReceiptOutbox({ supabase: db, sendReceipt, switches: { links: true, autoPosting: true, receipts: true } });
    expect(db.calls).toContainEqual({ rpc: "notification_outbox_complete", args: expect.objectContaining({ p_status: "uncertain", p_retry_in_seconds: null }) });
  });

  it("a failed send backs off, and stops at its last attempt", async () => {
    const db = fakeDb({ notification_outbox_claim: () => [job({ attempts: 2 }), job({ id: "j2", attempts: 5 })], notification_outbox_complete: () => null });
    const sendReceipt = vi.fn(async () => ({ outcome: "failed" as const, reason: "PDF render failed" }));
    await drainReceiptOutbox({ supabase: db, sendReceipt, switches: { links: true, autoPosting: true, receipts: true } });
    const completes = db.calls.filter((call) => call.rpc === "notification_outbox_complete").map((call) => call.args);
    expect(completes[0]).toMatchObject({ p_status: "failed", p_retry_in_seconds: 240 });
    expect(completes[1]).toMatchObject({ p_status: "failed", p_retry_in_seconds: null });
  });
});
