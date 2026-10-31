import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/whatsapp/data/aisensy", () => ({
  isAisensyConfigured: () => true,
  sendAisensyCampaignMessage: () => {
    throw new Error("One's staff alerts never call AiSensy directly");
  },
}));
vi.mock("@/modules/staff-notices/data/dispatcher", () => ({ dispatchStaffNotices: vi.fn(async () => null) }));
vi.mock("@/modules/staff-notices/data/enqueue", () => ({ queueStaffNoticeToPermission: vi.fn(async () => 0) }));

import { drainStaffPaymentAlerts, queueOnlineReviewNotices } from "@/modules/payments/data/online/staff-alerts";

/**
 * The drain that tells the office about an online receipt (go-live Phase F,
 * plan §8.4), against a fake database: One's version of the fees app's
 * tests/integration/online-staff-alerts.test.ts. The WhatsApp half becomes
 * staff notices in the outbox (consent and limits asked there), never a direct
 * AiSensy call; the push half is closed as `no_devices` (One has no push
 * sign-up). Synthetic ids only.
 */

type Alert = {
  id: string;
  receipt_id: string;
  student_id: string | null;
  receipt_number: string;
  amount_rupees: number;
  push_status: string;
  whatsapp_status: string;
  whatsapp_attempts: number;
};

const baseAlert: Alert = {
  id: "alert-1",
  receipt_id: "rcpt-1",
  student_id: "stu-1",
  receipt_number: "SVP-2026-27-1042",
  amount_rupees: 5000,
  push_status: "queued",
  whatsapp_status: "queued",
  whatsapp_attempts: 0,
};

function fakeDb(options: {
  alerts?: Alert[];
  whatsappOn?: string | null;
  sessionLabel?: string | null;
  captures?: Array<Record<string, unknown>>;
  intents?: Array<Record<string, unknown>>;
  claimError?: boolean;
}) {
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const result = (data: unknown) => ({ data, error: null });
  const chain = (data: unknown, single = false) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["eq", "in", "is", "gte", "order", "limit", "select"]) builder[name] = () => builder;
    builder.maybeSingle = async () => result(single ? data : null);
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result(data)).then(resolve);
    return builder;
  };
  return {
    updates,
    rpc: async (fn: string) =>
      fn === "staff_payment_alert_claim"
        ? options.claimError
          ? { data: null, error: { message: "boom" } }
          : result(options.alerts ?? [])
        : result(null),
    from(table: string) {
      if (table === "app_settings") return chain({ value: options.whatsappOn ?? null }, true);
      if (table === "students") {
        return chain([
          {
            id: "stu-1",
            full_name: "Test Child One",
            class_ref:
              options.sessionLabel === null
                ? null
                : { class_name: "Class 2", section: "A", stream_name: null, session_label: options.sessionLabel ?? "2026-27" },
          },
        ]);
      }
      if (table === "online_payment_captures") return chain(options.captures ?? []);
      if (table === "online_payment_intents") return chain(options.intents ?? []);
      if (table === "online_payment_orders") return chain([]);
      if (table === "whatsapp_reminder_sends") return chain([]);
      if (table === "staff_payment_alerts") {
        return {
          update: (values: Record<string, unknown>) => ({
            eq: async (_column: string, id: string) => {
              updates.push({ id, values });
              return result(null);
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const NOW = () => new Date("2026-11-02T05:00:00.000Z");

describe("drainStaffPaymentAlerts", () => {
  it("queues one online_payment staff notice per alert for fees:collect when the switch is on", async () => {
    const db = fakeDb({ alerts: [baseAlert], whatsappOn: "true" });
    const queue = vi.fn(async () => 2);
    const dispatch = vi.fn(async () => null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await drainStaffPaymentAlerts({ supabase: db, queue: queue as any, dispatch: dispatch as any, now: NOW, confined: false });

    expect(result).toMatchObject({ alerts: 1, whatsappSent: 1, pushed: 0 });
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "online_payment:rcpt-1",
        kind: "online_payment",
        permission: "fees:collect",
        sessionLabel: "2026-27",
        payload: expect.objectContaining({ receipt_number: "SVP-2026-27-1042", amount_rupees: 5000, class_label: "Class 2 - Section A" }),
      }),
    );
    expect(db.updates[0].values).toMatchObject({ whatsapp_status: "sent", push_status: "no_devices", locked_until: null });
    expect(dispatch).toHaveBeenCalled();
  });

  it("records 'off' and queues nothing while the switch is off or unreadable", async () => {
    for (const value of ["false", null, "TRUE?"]) {
      const db = fakeDb({ alerts: [baseAlert], whatsappOn: value });
      const queue = vi.fn(async () => 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await drainStaffPaymentAlerts({ supabase: db, queue: queue as any, dispatch: vi.fn() as any, now: NOW, confined: false });
      expect(queue).not.toHaveBeenCalled();
      expect(db.updates[0].values).toMatchObject({ whatsapp_status: "off", push_status: "no_devices" });
    }
  });

  it("queues nothing when the student's session cannot be read: a TEST payment must never look real", async () => {
    const db = fakeDb({ alerts: [baseAlert], whatsappOn: "true", sessionLabel: null });
    const queue = vi.fn(async () => 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await drainStaffPaymentAlerts({ supabase: db, queue: queue as any, dispatch: vi.fn() as any, now: NOW, confined: false });
    expect(queue).not.toHaveBeenCalled();
    expect(db.updates[0].values).toMatchObject({ whatsapp_status: "not_configured" });
  });

  it("carries a TEST payment's session to the outbox, which holds it to the allowlist", async () => {
    const db = fakeDb({ alerts: [baseAlert], whatsappOn: "true", sessionLabel: "TEST-2026-27" });
    const queue = vi.fn(async () => 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await drainStaffPaymentAlerts({ supabase: db, queue: queue as any, dispatch: vi.fn() as any, now: NOW, confined: false });
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ sessionLabel: "TEST-2026-27" }));
  });

  it("retries a queue failure later, with backoff, and never marks it sent", async () => {
    const db = fakeDb({ alerts: [baseAlert], whatsappOn: "true" });
    const queue = vi.fn(async () => {
      throw new Error("database away");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await drainStaffPaymentAlerts({ supabase: db, queue: queue as any, dispatch: vi.fn() as any, now: NOW, confined: false });
    expect(db.updates[0].values).toMatchObject({ whatsapp_status: "failed", whatsapp_attempts: 1 });
    expect(db.updates[0].values.next_attempt_at).toBe("2026-11-02T05:02:00.000Z");
  });

  it("releases the lease and does nothing else when out of time", async () => {
    const db = fakeDb({ alerts: [baseAlert], whatsappOn: "true" });
    const queue = vi.fn(async () => 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await drainStaffPaymentAlerts({ supabase: db, queue: queue as any, dispatch: vi.fn() as any, now: NOW, confined: false, outOfTime: () => true });
    expect(queue).not.toHaveBeenCalled();
    expect(Object.keys(db.updates[0].values).sort()).toEqual(["locked_until", "updated_at"]);
  });

  it("survives a failed claim and still looks for captures to review", async () => {
    const db = fakeDb({ claimError: true, captures: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await drainStaffPaymentAlerts({ supabase: db, queue: vi.fn() as any, dispatch: vi.fn() as any, now: NOW, confined: false });
    expect(result).toEqual({ alerts: 0, pushed: 0, whatsappSent: 0, reviews: 0 });
  });
});

describe("queueOnlineReviewNotices", () => {
  it("queues one online_review per capture needing a person, keyed by the capture, to fees:accounts", async () => {
    const db = fakeDb({
      captures: [{ id: "cap-1", amount_paise: 450000, intent_id: "int-1", order_id: null, created_at: "2026-11-02T04:00:00Z" }],
      intents: [{ id: "int-1", student_id: "stu-1", session_label: "2026-27" }],
    });
    const queue = vi.fn(async () => 2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queued = await queueOnlineReviewNotices({ supabase: db, queue: queue as any, now: NOW, confined: false });
    expect(queued).toBe(2);
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "online_review:cap-1",
        kind: "online_review",
        permission: "fees:accounts",
        sessionLabel: "2026-27",
        payload: expect.objectContaining({ capture_id: "cap-1", amount_rupees: 4500 }),
      }),
    );
  });

  it("skips a capture whose session it cannot place", async () => {
    const db = fakeDb({
      captures: [{ id: "cap-2", amount_paise: 100, intent_id: null, order_id: null, created_at: "2026-11-02T04:00:00Z" }],
    });
    const queue = vi.fn(async () => 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await queueOnlineReviewNotices({ supabase: db, queue: queue as any, now: NOW, confined: false })).toBe(0);
    expect(queue).not.toHaveBeenCalled();
  });
});

describe("review of PR #148", () => {
  it("never stores the child's name: the payload names the student by id, the outbox reads the name at send time", async () => {
    const db = fakeDb({ alerts: [baseAlert], whatsappOn: "true" });
    const queue = vi.fn(async () => 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await drainStaffPaymentAlerts({ supabase: db, queue: queue as any, dispatch: vi.fn() as any, now: NOW, confined: false });
    const payload = (queue.mock.calls[0] as unknown as [{ payload: Record<string, unknown> }])[0].payload;
    expect(payload).toMatchObject({ student_id: "stu-1" });
    expect(payload).not.toHaveProperty("student_name");
    expect(JSON.stringify(payload)).not.toContain("Test Child One");
  });

  it("on a confined deployment claims no alert row and queues review notices for TEST captures only", async () => {
    const db = fakeDb({
      alerts: [baseAlert],
      whatsappOn: "true",
      captures: [
        { id: "cap-real", amount_paise: 100, intent_id: "int-real", order_id: null, created_at: "2026-11-02T04:00:00Z" },
        { id: "cap-test", amount_paise: 100, intent_id: "int-test", order_id: null, created_at: "2026-11-02T04:00:00Z" },
      ],
      intents: [
        { id: "int-real", student_id: "stu-1", session_label: "2026-27" },
        { id: "int-test", student_id: "stu-1", session_label: "TEST-2026-27" },
      ],
    });
    const rpc = vi.spyOn(db, "rpc");
    const queue = vi.fn(async () => 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await drainStaffPaymentAlerts({ supabase: db, queue: queue as any, dispatch: vi.fn() as any, now: NOW, confined: true });

    expect(rpc).not.toHaveBeenCalledWith("staff_payment_alert_claim", expect.anything());
    expect(db.updates).toHaveLength(0);
    expect(result).toMatchObject({ alerts: 0, whatsappSent: 0, reviews: 1 });
    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ key: "online_review:cap-test", sessionLabel: "TEST-2026-27" }));
  });
});
