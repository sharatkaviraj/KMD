import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const afterSpy = vi.fn();
const processInboxEventById = vi.fn();
const afterOnlinePosting = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/modules/payments/data/online/service", () => ({
  processInboxEventById: (...args: unknown[]) => processInboxEventById(...args),
}));
vi.mock("@/modules/payments/data/online/after-posting", () => ({
  afterOnlinePosting: (...args: unknown[]) => afterOnlinePosting(...args),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => afterSpy(task),
}));

import { GET, POST } from "@/app/api/webhooks/razorpay/route";
import { signRazorpayBody } from "@/modules/payments/domain/online/razorpay-signature";

const SECRET = "whsec_unit_test_only";

const body = JSON.stringify({
  entity: "event",
  account_id: "acc_TEST",
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_ABC123", amount: 800000, currency: "INR", status: "captured", contact: "+919999999999" } } },
  created_at: 1793180000,
});

function request(raw: string, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/webhooks/razorpay", { method: "POST", body: raw, headers });
}

describe("Razorpay webhook intake", () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
    process.env.RAZORPAY_KEY_SECRET = "fake";
    delete process.env.RAZORPAY_ACCOUNT_ID;
    rpc.mockReset();
    afterSpy.mockReset();
  });
  afterEach(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it("does not exist until its secret is set", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect((await POST(request(body))).status).toBe(404);
    expect((await GET()).status).toBe(404);
  });

  it("refuses a bad signature before touching the database", async () => {
    const response = await POST(request(body, { "x-razorpay-signature": signRazorpayBody(body, "wrong"), "x-razorpay-event-id": "evt_JxA1b2C3d4" }));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an oversized body", async () => {
    const big = "x".repeat(70 * 1024);
    expect((await POST(request(big, { "x-razorpay-signature": signRazorpayBody(big, SECRET) }))).status).toBe(413);
  });

  it("records a verified event in the inbox, acknowledges, and processes AFTER the reply", async () => {
    rpc.mockResolvedValue({ data: { id: "row1", duplicate: false }, error: null });
    const response = await POST(request(body, { "x-razorpay-signature": signRazorpayBody(body, SECRET), "x-razorpay-event-id": "evt_JxA1b2C3d4" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("online_payment_record_event", expect.objectContaining({
      p_provider_event_id: "evt_JxA1b2C3d4",
      p_event_type: "payment.captured",
      p_provider_payment_id: "pay_ABC123",
    }));
    // The parent's phone number in the payload is not stored.
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain("9999999999");
    expect(afterSpy).toHaveBeenCalledTimes(1);
  });

  it("once the payment posts, sends the receipt and refreshes the office at once, not at the next cron", async () => {
    rpc.mockResolvedValue({ data: { id: "row1", duplicate: false }, error: null });
    processInboxEventById.mockResolvedValue("applied");
    afterOnlinePosting.mockResolvedValue({ postings: 1, receiptsSent: 1 });
    await POST(request(body, { "x-razorpay-signature": signRazorpayBody(body, SECRET), "x-razorpay-event-id": "evt_JxA1b2C3d4" }));
    await afterSpy.mock.calls[0][0]();
    expect(processInboxEventById).toHaveBeenCalledWith(expect.objectContaining({ eventId: "row1" }));
    expect(afterOnlinePosting).toHaveBeenCalledWith(expect.objectContaining({ paymentIds: ["pay_ABC123"] }));
  });

  it("does not follow through for a payment that did not post", async () => {
    rpc.mockResolvedValue({ data: { id: "row1", duplicate: false }, error: null });
    for (const outcome of ["not_ours", "review_required", "waiting_for_capture", "retry", null]) {
      afterSpy.mockReset();
      afterOnlinePosting.mockReset();
      processInboxEventById.mockResolvedValue(outcome);
      await POST(request(body, { "x-razorpay-signature": signRazorpayBody(body, SECRET), "x-razorpay-event-id": "evt_JxA1b2C3d4" }));
      await afterSpy.mock.calls[0][0]();
      expect(afterOnlinePosting).not.toHaveBeenCalled();
    }
  });

  it("a redelivered event is acknowledged and not processed twice", async () => {
    rpc.mockResolvedValue({ data: { id: "row1", duplicate: true }, error: null });
    const response = await POST(request(body, { "x-razorpay-signature": signRazorpayBody(body, SECRET), "x-razorpay-event-id": "evt_JxA1b2C3d4" }));
    expect(await response.json()).toMatchObject({ ok: true, duplicate: true });
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it("answers 500 when the inbox cannot be written, so Razorpay delivers again", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    const response = await POST(request(body, { "x-razorpay-signature": signRazorpayBody(body, SECRET), "x-razorpay-event-id": "evt_JxA1b2C3d4" }));
    expect(response.status).toBe(500);
  });

  it("acknowledges an event type it does not act on, and stores nothing", async () => {
    const other = body.replace('"payment.captured"', '"invoice.paid"');
    const response = await POST(request(other, { "x-razorpay-signature": signRazorpayBody(other, SECRET), "x-razorpay-event-id": "evt_JxA1b2C3d4" }));
    expect(await response.json()).toMatchObject({ ignored: "unhandled_event" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores an event signed for a different Razorpay account", async () => {
    process.env.RAZORPAY_ACCOUNT_ID = "acc_SCHOOL";
    const response = await POST(request(body, { "x-razorpay-signature": signRazorpayBody(body, SECRET), "x-razorpay-event-id": "evt_JxA1b2C3d4" }));
    expect(await response.json()).toMatchObject({ ignored: "other_account" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
