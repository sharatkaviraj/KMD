import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  confined: false,
  receipts: [] as Array<Record<string, unknown>>,
  truncated: false,
  closeEvents: [] as Array<Record<string, unknown>>,
  queued: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/platform/deployment/confinement", () => ({ isConfinedDeployment: () => state.confined }));
vi.mock("@/modules/receipts/vx/data", () => ({
  loadDeskReceipts: async () => ({ rows: state.receipts, truncated: state.truncated }),
}));
vi.mock("@/modules/staff-notices/data/enqueue", () => ({
  queueStaffNotice: vi.fn(async () => null),
  queueStaffNoticeToPermission: vi.fn(async (input: Record<string, unknown>) => {
    state.queued.push(input);
    return 2;
  }),
}));
vi.mock("@/modules/staff-notices/data/dispatcher", () => ({
  dispatchStaffNotices: vi.fn(async () => ({ accepted: 0, held: 0, suppressed: 2 })),
}));
vi.mock("@/platform/supabase/admin", () => {
  const chain = (data: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "is", "gte", "order", "range", "schema"]) builder[name] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return builder;
  };
  return {
    createAdminClient: () => ({
      schema: () => ({
        from: (table: string) =>
          table === "app_settings" ? chain([{ value: "2026-27" }]) : chain([{ session_label: "2026-27" }]),
      }),
      from: (table: string) => (table === "fee_day_close_events" ? chain(state.closeEvents) : chain([])),
    }),
  };
});

import { feeDayNotClosed, feeDaySummary } from "@/modules/jobs/data/job-work";

/**
 * The fee day for staff (go-live Phase F, plan §8.2): the 19:00 collection
 * summary and the 20:00 day-not-closed check queue staff notices to everybody
 * with `fees:accounts`, from the desk's own figures, and a confined deployment
 * never reads real fee data. Nothing is sent here.
 */

const receipt = (mode: string, amount: number, extra: Record<string, unknown> = {}) => ({
  paymentDate: "2026-11-02",
  paymentMode: mode,
  totalAmount: amount,
  isReversed: false,
  ...extra,
});

beforeEach(() => {
  state.confined = false;
  state.receipts = [];
  state.truncated = false;
  state.closeEvents = [];
  state.queued = [];
});

describe("fee-day-summary (19:00)", () => {
  it("queues the day's total, count and modes to fees:accounts, keyed by session and day", async () => {
    state.receipts = [receipt("cash", 3000), receipt("upi", 2000), receipt("online", 500), receipt("cash", 999, { isReversed: true })];
    const summary = await feeDaySummary("2026-11-02");

    expect(summary).toMatchObject({ receipts: 3, total: 5500, queued: 2 });
    expect(state.queued[0]).toMatchObject({
      key: "day_collection:2026-27:2026-11-02",
      kind: "day_collection",
      permission: "fees:accounts",
      sessionLabel: "2026-27",
      payload: { date: "2026-11-02", total_rupees: 5500, receipts: 3, by_mode: { cash: 3000, upi: 2500, cheque: 0, bank: 0 } },
    });
  });

  it("says nothing on a day with no receipts", async () => {
    expect(await feeDaySummary("2026-11-02")).toMatchObject({ queued: 0, note: "no receipts today" });
    expect(state.queued).toHaveLength(0);
  });

  it("refuses an incomplete day rather than report a wrong total", async () => {
    state.receipts = [receipt("cash", 100)];
    state.truncated = true;
    await expect(feeDaySummary("2026-11-02")).rejects.toThrow(/incomplete/);
  });

  it("on a confined deployment reads no real fee data at all", async () => {
    state.confined = true;
    state.receipts = [receipt("cash", 100)];
    expect(await feeDaySummary("2026-11-02")).toMatchObject({ queued: 0 });
    expect(state.queued).toHaveLength(0);
  });
});

describe("fee-day-not-closed (20:00)", () => {
  it("queues a day-not-closed notice when today has receipts and no close", async () => {
    state.receipts = [receipt("cash", 3000)];
    const summary = await feeDayNotClosed("2026-11-02");
    expect(summary).toMatchObject({ closed: "no", queued: 2 });
    expect(state.queued[0]).toMatchObject({ key: "day_not_closed:2026-27:2026-11-02", kind: "day_not_closed", permission: "fees:accounts" });
    // Worth sending until 21:00 IST that night, not after.
    expect((state.queued[0].notAfter as Date).toISOString()).toBe("2026-11-02T15:30:00.000Z");
  });

  it("is quiet when the day was closed, and loud again after a reopen", async () => {
    state.receipts = [receipt("cash", 3000)];
    state.closeEvents = [{ id: "e1", action: "close", created_at: "2026-11-02T12:00:00Z" }];
    expect(await feeDayNotClosed("2026-11-02")).toMatchObject({ closed: "yes", queued: 0 });

    state.closeEvents.push({ id: "e2", action: "reopen", created_at: "2026-11-02T13:00:00Z" });
    expect(await feeDayNotClosed("2026-11-02")).toMatchObject({ closed: "no", queued: 2 });
  });

  it("does not ask for a close on a day with no receipts", async () => {
    expect(await feeDayNotClosed("2026-11-02")).toMatchObject({ queued: 0 });
  });
});
