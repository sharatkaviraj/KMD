import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readOnlineScreen } from "@/modules/payments/data/online/screen-reads";
import {
  captureSessionLabels,
  reconciliationByDay,
  sessionScopeFor,
  viewerMaySeeCapture,
} from "@/modules/payments/domain/online/session-fence";

/**
 * The staff Online payments screen reads with the service-role client, which
 * the database's test-session fence does not reach (go-live Phase E review;
 * owner override T1). These hold the screen's own fence: a test account —
 * everybody on a confined deployment — sees no real family's payment, real
 * staff see no TEST one, and only a real admin sees both.
 */

const TEST_ACCOUNT = { role: "admin" as const, isTestAccount: true };
const ACCOUNTANT = { role: "accountant" as const, isTestAccount: false };
const REAL_ADMIN = { role: "admin" as const, isTestAccount: false };

const student = (n: string) => ({ admission_no: `TEST-${n}`, full_name: `Sample Child ${n}` });

const FIXTURES: Record<string, Array<Record<string, unknown>>> = {
  online_payment_captures: [
    // pending/review list rows
    { id: "c-real", application_status: "review_required", online_payment_intents: { session_label: "2026-27", students: student("1") }, online_payment_orders: null },
    { id: "c-test", application_status: "pending", online_payment_intents: { session_label: "TEST-2026-27", students: student("2") }, online_payment_orders: null },
    { id: "c-order-real", application_status: "pending", online_payment_intents: null, online_payment_orders: { online_payment_order_lines: [{ session_label: "2026-27", students: student("3") }] } },
    { id: "c-unknown", application_status: "review_required", online_payment_intents: null, online_payment_orders: null },
  ],
  online_payment_intents: [
    { id: "i-real", session_label: "2026-27", students: student("1") },
    { id: "i-test", session_label: "TEST-2026-27", students: student("2") },
  ],
  notification_outbox: [
    { id: "o-real", session_label: "2026-27", payload: {} },
    { id: "o-test", session_label: "TEST-2026-27", payload: {} },
  ],
  online_payment_orders: [
    { id: "ord-real", online_payment_order_lines: [{ session_label: "2026-27", students: student("3") }] },
    { id: "ord-test", online_payment_order_lines: [{ session_label: "TEST-2026-27", students: student("4") }] },
  ],
  online_payment_audit: [
    { id: 2, action: "capture_applied", actor: "webhook", created_at: "2026-10-31T00:00:00Z" },
    { id: 1, action: "switch_changed", actor: "staff:x", created_at: "2026-10-30T00:00:00Z" },
  ],
  v_online_payment_reconciliation: [{ captured_on: "2026-10-31", provider_mode: "live", captures: 9 }],
};

/** Answers every query with its table's fixture, unfiltered, and records the filters asked for. */
function fakeDb() {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  return {
    calls,
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "order", "limit", "or", "not", "eq", "gte"]) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return chain;
        };
      }
      chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: FIXTURES[table] ?? [], error: null });
      return chain;
    },
  };
}

const ids = (rows: Array<Record<string, unknown>>) => rows.map((row) => row.id);

describe("who sees what on the Online payments screen", () => {
  it("scopes: a test account (even role admin) is test, real staff real, a real admin all", () => {
    expect(sessionScopeFor(TEST_ACCOUNT)).toBe("test");
    expect(sessionScopeFor(ACCOUNTANT)).toBe("real");
    expect(sessionScopeFor(REAL_ADMIN)).toBe("all");
  });

  it("a test account gets no real-session row in any list", async () => {
    const db = fakeDb();
    const screen = await readOnlineScreen(db, TEST_ACCOUNT);
    expect(ids(screen.attention.data)).toEqual(["c-test"]);
    expect(ids(screen.intents.data)).toEqual(["i-test"]);
    expect(screen.outbox.data.map((row) => row.id)).toEqual(["o-test"]);
    expect(ids(screen.orders.data)).toEqual(["ord-test"]);
    // The trail names payments of every session; only switch changes remain.
    expect(screen.audit.data.map((row) => row.action)).toEqual(["switch_changed"]);
    // The view sums every session: never read for a fenced viewer.
    expect(db.calls.some((call) => call.table === "v_online_payment_reconciliation")).toBe(false);
    // And the database is asked for test labels only, so a page stays full.
    expect(db.calls).toContainEqual({ table: "online_payment_intents", method: "or", args: ["session_label.like.TEST-*,session_label.like.UAT-*,session_label.like.DEMO-*"] });
    expect(db.calls).toContainEqual({
      table: "online_payment_orders",
      method: "or",
      args: ["session_label.like.TEST-*,session_label.like.UAT-*,session_label.like.DEMO-*", { referencedTable: "online_payment_order_lines" }],
    });
  });

  it("real staff get no TEST-session row, and no capture that cannot be placed", async () => {
    const db = fakeDb();
    const screen = await readOnlineScreen(db, ACCOUNTANT);
    expect(ids(screen.attention.data)).toEqual(["c-real", "c-order-real"]);
    expect(ids(screen.intents.data)).toEqual(["i-real"]);
    expect(screen.outbox.data.map((row) => row.id)).toEqual(["o-real"]);
    expect(ids(screen.orders.data)).toEqual(["ord-real"]);
    expect(db.calls).toContainEqual({ table: "notification_outbox", method: "not", args: ["session_label", "like", "TEST-%"] });
    expect(db.calls).toContainEqual({ table: "online_payment_orders", method: "not", args: ["online_payment_order_lines.session_label", "like", "DEMO-%"] });
  });

  it("a real admin reads exactly what the fees app's screen reads", async () => {
    const db = fakeDb();
    const screen = await readOnlineScreen(db, REAL_ADMIN);
    expect(ids(screen.attention.data)).toEqual(["c-real", "c-test", "c-order-real", "c-unknown"]);
    expect(screen.audit.data).toHaveLength(2);
    expect(screen.recon.data).toEqual(FIXTURES.v_online_payment_reconciliation);
    expect(db.calls.some((call) => call.method === "or" || call.method === "not")).toBe(false);
  });
});

describe("placing a capture", () => {
  it("through its intent, or every line of its order", () => {
    expect(captureSessionLabels({ online_payment_intents: { session_label: "2026-27" } })).toEqual(["2026-27"]);
    expect(
      captureSessionLabels({ online_payment_orders: { online_payment_order_lines: [{ session_label: "TEST-2026-27" }, { session_label: "2026-27" }] } }),
    ).toEqual(["TEST-2026-27", "2026-27"]);
  });

  it("a capture spanning both sides is a real admin's only", () => {
    const mixed = { online_payment_orders: { online_payment_order_lines: [{ session_label: "TEST-2026-27" }, { session_label: "2026-27" }] } };
    expect(viewerMaySeeCapture(TEST_ACCOUNT, mixed)).toBe(false);
    expect(viewerMaySeeCapture(ACCOUNTANT, mixed)).toBe(false);
    expect(viewerMaySeeCapture(REAL_ADMIN, mixed)).toBe(true);
  });
});

describe("the reconciliation a fenced viewer gets", () => {
  it("adds up like the view: by India-time day and mode, receipts from the capture or its lines", () => {
    const rows = reconciliationByDay([
      // 31 Oct 20:00 UTC is 1 Nov in India.
      { captured_at: "2026-10-31T20:00:00Z", provider_mode: "test", amount_paise: 5000, application_status: "applied", fee_paise: 100, tax_paise: 18, receipt: { total_amount: 50 } },
      {
        captured_at: "2026-11-01T05:00:00Z",
        provider_mode: "test",
        amount_paise: 20000,
        application_status: "applied",
        fee_paise: 400,
        tax_paise: 72,
        receipt: null,
        online_payment_orders: { online_payment_order_lines: [{ receipt: { total_amount: 120 } }, { receipt: { total_amount: 80 } }] },
      },
      { captured_at: "2026-11-01T06:00:00Z", provider_mode: "test", amount_paise: 3000, application_status: "review_required", fee_paise: null, tax_paise: null },
      { captured_at: "2026-10-30T06:00:00Z", provider_mode: "live", amount_paise: 1000, application_status: "pending", fee_paise: 10, tax_paise: 2 },
    ]);
    expect(rows).toEqual([
      {
        captured_on: "2026-11-01",
        provider_mode: "test",
        captures: 3,
        captured_paise: 28000,
        applied: 2,
        applied_paise: 25000,
        in_review: 1,
        in_review_paise: 3000,
        awaiting_posting: 0,
        awaiting_posting_paise: 0,
        receipted_paise: 25000,
        provider_fee_paise: 500,
        provider_tax_paise: 90,
      },
      expect.objectContaining({ captured_on: "2026-10-30", provider_mode: "live", awaiting_posting: 1, awaiting_posting_paise: 1000 }),
    ]);
  });
});
