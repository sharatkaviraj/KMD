import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const drainFinancialViewRefresh = vi.fn(async () => {
  calls.push("drain_views");
});
const revalidateSessionFinance = vi.fn((session: string, _studentIds?: string[]) => {
  void _studentIds;
  calls.push(`revalidate:${session}`);
});
const revalidateAfterPaymentPosting = vi.fn();
const publishOfficeSyncEventWith = vi.fn(async (_db: unknown, payload: { sessionLabel: string }) => {
  calls.push(`office_sync:${payload.sessionLabel}`);
});

vi.mock("server-only", () => ({}));
vi.mock("@/modules/system-sync/data/financial-view-refresh", () => ({
  drainFinancialViewRefresh: () => drainFinancialViewRefresh(),
}));
vi.mock("@/modules/system-sync/data/finance-revalidation", () => ({
  revalidateSessionFinance: (session: string, ids: string[]) => revalidateSessionFinance(session, ids),
  revalidateAfterPaymentPosting: (ids: string[]) => revalidateAfterPaymentPosting(ids),
}));
vi.mock("@/modules/system-sync/data/office-sync-events", () => ({
  publishOfficeSyncEventWith: (db: unknown, payload: { sessionLabel: string }) => publishOfficeSyncEventWith(db, payload),
}));
vi.mock("@/modules/whatsapp/data/receipt-notice", () => ({ sendReceiptNotice: vi.fn() }));
const drainStaffPaymentAlerts = vi.fn(async () => {
  calls.push("staff_alerts");
  return { alerts: 1, pushed: 1, whatsappSent: 1 };
});
vi.mock("@/modules/payments/data/online/staff-alerts", () => ({
  drainStaffPaymentAlerts: () => drainStaffPaymentAlerts(),
}));

import { afterOnlinePosting, postingsForPayments } from "@/modules/payments/data/online/after-posting";

type Capture = {
  provider_payment_id: string;
  application_status: string;
  online_payment_intents: { student_id: string; session_label: string } | null;
};

function fakeDb(captures: Capture[], jobs: Array<Record<string, unknown>>) {
  const completed: Array<{ id: string; status: string }> = [];
  const db = {
    completed,
    from(table: string) {
      if (table === "online_payment_captures") {
        return {
          select: () => ({
            in: async (_column: string, ids: string[]) => ({
              data: captures.filter((row) => ids.includes(row.provider_payment_id)),
              error: null,
            }),
          }),
        };
      }
      if (table === "app_settings") {
        return {
          select: () => ({
            in: async () => ({ data: [{ key: "online_payment_receipts_enabled", value: "true" }], error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name: string, params: Record<string, unknown>) {
      if (name === "notification_outbox_claim") {
        calls.push("claim_outbox");
        return { data: jobs, error: null };
      }
      if (name === "notification_outbox_complete") {
        completed.push({ id: String(params.p_id), status: String(params.p_status) });
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return db;
}

const applied: Capture = {
  provider_payment_id: "pay_Applied1",
  application_status: "applied",
  online_payment_intents: { student_id: "stu-1", session_label: "TEST-2026-27" },
};

const job = {
  id: "job-1",
  receipt_id: "rcpt-1",
  student_id: "stu-1",
  session_label: "TEST-2026-27",
  attempts: 0,
  max_attempts: 5,
  payload: { receipt_number: "SVP20261029-0016", amount: 50, payment_date: "2026-10-29" },
};

describe("after an online payment posts", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  it("drains the views and refreshes the office BEFORE the receipt goes out, then sends it now", async () => {
    const db = fakeDb([applied], [job]);
    const sendReceipt = vi.fn(async () => {
      calls.push("send_receipt");
      return { outcome: "provider_accepted" as const, providerMessageId: "msg-1" };
    });

    const result = await afterOnlinePosting({ supabase: db, paymentIds: ["pay_Applied1"], sendReceipt });

    expect(result).toEqual({ postings: 1, receiptsSent: 1 });
    // The receipt quotes the balance from the matview, so the drain comes first.
    // The office's alert goes before the parent's receipt; it reads nothing
    // from the matview, so it need not wait behind the outbox.
    expect(calls).toEqual([
      "drain_views",
      "revalidate:TEST-2026-27",
      "office_sync:TEST-2026-27",
      "staff_alerts",
      "claim_outbox",
      "send_receipt",
    ]);
    expect(sendReceipt).toHaveBeenCalledWith(expect.objectContaining({ receiptId: "rcpt-1", amountPaid: 50 }));
    expect(revalidateAfterPaymentPosting).toHaveBeenCalledWith(["stu-1"]);
    expect(db.completed).toEqual([{ id: "job-1", status: "provider_accepted" }]);
  });

  it("does nothing for a payment that did not post", async () => {
    const db = fakeDb([{ ...applied, application_status: "review_required" }], [job]);
    const sendReceipt = vi.fn();
    expect(await afterOnlinePosting({ supabase: db, paymentIds: ["pay_Applied1"], sendReceipt })).toEqual({
      postings: 0,
      receiptsSent: 0,
    });
    expect(calls).toEqual([]);
    expect(sendReceipt).not.toHaveBeenCalled();
  });

  it("never throws when the send itself fails: the money has posted and the cron retries", async () => {
    const db = fakeDb([applied], [job]);
    const sendReceipt = vi.fn(async () => {
      throw new Error("AiSensy down");
    });
    await expect(afterOnlinePosting({ supabase: db, paymentIds: ["pay_Applied1"], sendReceipt })).resolves.toEqual({
      postings: 0,
      receiptsSent: 0,
    });
    expect(drainFinancialViewRefresh).toHaveBeenCalledTimes(1);
  });

  it("still sends the parent's receipt when the staff alert fails", async () => {
    drainStaffPaymentAlerts.mockImplementationOnce(async () => {
      throw new Error("push service down");
    });
    const db = fakeDb([applied], [job]);
    const sendReceipt = vi.fn(async () => ({ outcome: "provider_accepted" as const, providerMessageId: "msg-1" }));
    expect(await afterOnlinePosting({ supabase: db, paymentIds: ["pay_Applied1"], sendReceipt })).toEqual({
      postings: 1,
      receiptsSent: 1,
    });
  });

  it("alerts nobody for a payment that did not post", async () => {
    const db = fakeDb([{ ...applied, application_status: "review_required" }], [job]);
    await afterOnlinePosting({ supabase: db, paymentIds: ["pay_Applied1"], sendReceipt: vi.fn() });
    expect(drainStaffPaymentAlerts).not.toHaveBeenCalled();
  });

  it("finds every child a checkout order posted to", async () => {
    const db = fakeDb(
      [
        {
          provider_payment_id: "pay_Order1",
          application_status: "applied",
          online_payment_intents: null,
          online_payment_orders: {
            online_payment_order_lines: [
              { student_id: "stu-1", session_label: "TEST-2026-27" },
              { student_id: "stu-2", session_label: "TEST-2026-27" },
            ],
          },
        } as unknown as Capture,
      ],
      [],
    );
    expect(await postingsForPayments(db, ["pay_Order1"])).toEqual([
      { studentId: "stu-1", sessionLabel: "TEST-2026-27", paymentId: "pay_Order1" },
      { studentId: "stu-2", sessionLabel: "TEST-2026-27", paymentId: "pay_Order1" },
    ]);
  });

  it("only reads Razorpay payment ids", async () => {
    const db = fakeDb([applied], []);
    expect(await postingsForPayments(db, ["not-a-payment", "pay_Applied1", "pay_Applied1"])).toEqual([
      { studentId: "stu-1", sessionLabel: "TEST-2026-27", paymentId: "pay_Applied1" },
    ]);
    expect(await postingsForPayments(db, ["drop table"])).toEqual([]);
  });
});
