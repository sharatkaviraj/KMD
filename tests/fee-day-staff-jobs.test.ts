import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  confined: false,
  receipts: [] as Array<Record<string, unknown>>,
  truncated: false,
  closeEvents: [] as Array<Record<string, unknown>>,
  queued: [] as Array<Record<string, unknown>>,
  sessions: ["2026-27"] as string[],
  testReceipts: [] as Array<Record<string, unknown>>,
  read: [] as string[],
  // app_settings.fee_writes_enabled: 'true' once One keeps the real year's fees itself (takeover day).
  feeWrites: "true" as string | null,
  feeWritesError: false,
}));

vi.mock("@/platform/deployment/confinement", () => ({ isConfinedDeployment: () => state.confined }));
vi.mock("@/modules/receipts/vx/data", () => ({
  loadDeskReceipts: async (sessionLabel: string) => {
    state.read.push(sessionLabel);
    return { rows: sessionLabel.startsWith("TEST-") ? state.testReceipts : state.receipts, truncated: state.truncated };
  },
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
  // app_settings answers by the key asked for: the active session, or the fee-writes switch.
  const settings = () => {
    let key = "";
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (_column: string, value: string) => {
      key = value;
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        key === "fee_writes_enabled"
          ? state.feeWritesError
            ? { data: null, error: { message: "unreadable" } }
            : { data: state.feeWrites === null ? [] : [{ value: state.feeWrites }], error: null }
          : { data: [{ value: "2026-27" }], error: null },
      ).then(resolve);
    return builder;
  };
  return {
    createAdminClient: () => ({
      schema: () => ({
        from: (table: string) =>
          table === "app_settings" ? settings() : chain(state.sessions.map((session_label) => ({ session_label }))),
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
  state.sessions = ["2026-27"];
  state.testReceipts = [];
  state.read = [];
  state.feeWrites = "true";
  state.feeWritesError = false;
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

describe("the TEST pass (review of PR #148): both kinds can be rehearsed under TEST-2026-27", () => {
  it("on production queues the real session and the TEST session, each under its own key", async () => {
    state.sessions = ["2026-27", "TEST-2026-27"];
    state.receipts = [receipt("cash", 3000)];
    state.testReceipts = [receipt("upi", 700)];
    const summary = await feeDaySummary("2026-11-02");

    expect(summary).toMatchObject({ receipts: 1, total: 3000, queued: 2, test_receipts: 1, test_queued: 2 });
    expect(state.queued.map((q) => q.key)).toEqual(["day_collection:2026-27:2026-11-02", "day_collection:TEST-2026-27:2026-11-02"]);
    expect(state.queued[1]).toMatchObject({ sessionLabel: "TEST-2026-27", payload: expect.objectContaining({ total_rupees: 700 }) });
  });

  it("on a confined deployment runs the TEST pass only and never reads the real session", async () => {
    state.confined = true;
    state.sessions = ["2026-27", "TEST-2026-27"];
    state.receipts = [receipt("cash", 3000)];
    state.testReceipts = [receipt("cash", 400)];

    const summary = await feeDaySummary("2026-11-02");
    expect(summary).toMatchObject({ queued: 0, note: "confined deployment: real fee data not read", test_queued: 2 });
    expect(state.read).toEqual(["TEST-2026-27"]);
    expect(state.queued.map((q) => q.sessionLabel)).toEqual(["TEST-2026-27"]);

    state.queued = [];
    state.read = [];
    const notClosed = await feeDayNotClosed("2026-11-02");
    expect(notClosed).toMatchObject({ test_queued: 2 });
    expect(state.read).toEqual(["TEST-2026-27"]);
    expect(state.queued[0]).toMatchObject({ key: "day_not_closed:TEST-2026-27:2026-11-02", kind: "day_not_closed" });
  });

  it("a TEST day with no receipts queues nothing", async () => {
    state.sessions = ["2026-27", "TEST-2026-27"];
    state.receipts = [receipt("cash", 3000)];
    expect(await feeDaySummary("2026-11-02")).toMatchObject({ queued: 2, test_receipts: 0, test_queued: 0 });
    expect(state.queued).toHaveLength(1);
  });
});

describe("while One's real year is the night's copy of the Fees app (D-648)", () => {
  // The office takes the money and closes its day in Fees; the copy is a night
  // behind (or part of a day, after a copy by hand), so the real year's fee day
  // stays the Fees app's until real fee writes are open in One.
  it("tells staff nothing about the real year, never even reads its receipts, and still rehearses TEST", async () => {
    state.feeWrites = "false";
    state.sessions = ["2026-27", "TEST-2026-27"];
    state.receipts = [receipt("cash", 3000)];
    state.testReceipts = [receipt("upi", 700)];

    const summary = await feeDaySummary("2026-11-02");
    expect(summary).toMatchObject({ queued: 0, note: expect.stringMatching(/copy of the Fees app/), test_receipts: 1, test_queued: 2 });
    expect(state.read).toEqual(["TEST-2026-27"]);
    expect(state.queued.map((q) => q.sessionLabel)).toEqual(["TEST-2026-27"]);

    state.queued = [];
    state.read = [];
    const notClosed = await feeDayNotClosed("2026-11-02");
    expect(notClosed).toMatchObject({ test_queued: 2 });
    expect(notClosed.closed).toBeUndefined();
    expect(state.queued.map((q) => q.sessionLabel)).toEqual(["TEST-2026-27"]);
  });

  it("an unset or unreadable switch is not One's either", async () => {
    state.receipts = [receipt("cash", 3000)];
    state.feeWrites = null;
    expect(await feeDaySummary("2026-11-02")).toMatchObject({ queued: 0, note: expect.stringMatching(/copy of the Fees app/) });
    state.feeWritesError = true;
    expect(await feeDayNotClosed("2026-11-02")).toMatchObject({ queued: 0, note: expect.stringMatching(/copy of the Fees app/) });
    expect(state.queued).toHaveLength(0);
    expect(state.read).toEqual([]);
  });
});
