import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Query = { table: string; columns: string; filters: [string, unknown][] };

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  requests: [] as Query[],
  throwAt: "",
  visible: true,
  paymentMode: "online",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/modules/receipts/data/reversals", () => ({
  getAllReceiptReversalTotals: vi.fn(),
  getReceiptReversalTotals: async () => new Map(),
  isReceiptReversed: () => false,
}));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const request: Query = { table, columns: "", filters: [] };
      state.requests.push(request);
      const query = {
        select: (columns: string) => { request.columns = columns; return query; },
        eq: (column: string, value: unknown) => { request.filters.push([column, value]); return query; },
        maybeSingle: async () => {
          if (table === state.throwAt) throw new Error("QA read unavailable");
          const matches = (state.rows[table] ?? []).filter((row) =>
            request.filters.every(([column, value]) => row[column] === value),
          );
          return matches.length > 1
            ? { data: null, error: { message: "Multiple rows" } }
            : { data: matches[0] ?? null, error: null };
        },
      };
      return query;
    },
  }),
}));

import { getReceiptDetailWith } from "@/modules/receipts/data/queries";

const receipt = () => ({
  id: "qa-receipt", student_id: "qa-student", receipt_number: "TST-100",
  payment_date: "2026-10-31", created_at: "2026-10-31T10:00:00Z",
  payment_mode: state.paymentMode, total_amount: 100, created_by: null,
  student_ref: { id: "qa-student", full_name: "QA Student", admission_no: "QA-100",
    class_ref: { session_label: "TEST-2026-27", class_name: "QA Class", section: null, stream_name: null } },
});

// The caller's existing client determines whether this receipt can be opened.
// Other detail reads are deliberately empty: this suite isolates method lookup.
function detailClient() {
  return {
    from: (table: string) => {
      let single = false;
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: () => { single = true; return query; },
        then: (resolve: (result: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({
            data: table === "receipts"
              ? single ? state.visible ? receipt() : null : [receipt()]
              : single ? null : [],
            error: null,
          }).then(resolve),
      };
      return query;
    },
  } as unknown as Parameters<typeof getReceiptDetailWith>[0];
}

const detail = () => getReceiptDetailWith(detailClient(), "qa-receipt");

beforeEach(() => {
  state.rows = {};
  state.requests = [];
  state.throwAt = "";
  state.visible = true;
  state.paymentMode = "online";
});

describe("receipt online method", () => {
  it("keeps a directly linked capture and does not read order lines", async () => {
    state.rows.online_payment_captures = [{ receipt_id: "qa-receipt", method: "upi" }];
    expect((await detail())?.onlineMethod).toBe("upi");
    expect(state.requests).toEqual([
      { table: "online_payment_captures", columns: "method", filters: [["receipt_id", "qa-receipt"]] },
    ]);
  });

  it("finds the applied capture of this receipt's one-tap order", async () => {
    state.rows.online_payment_order_lines = [
      { receipt_id: "qa-other-receipt", order_id: "qa-other-order" },
      { receipt_id: "qa-receipt", order_id: "qa-order" },
    ];
    state.rows.online_payment_captures = [
      { receipt_id: null, order_id: "qa-other-order", application_status: "applied", method: "card" },
      { receipt_id: null, order_id: "qa-order", application_status: "review_required", method: "card" },
      { receipt_id: null, order_id: "qa-order", application_status: "applied", method: "upi" },
    ];
    const result = await detail();
    expect(result?.paymentMode).toBe("online");
    expect(result?.onlineMethod).toBe("upi");
    expect(state.requests[1]).toEqual({
      table: "online_payment_order_lines", columns: "order_id", filters: [["receipt_id", "qa-receipt"]],
    });
    expect(state.requests[2].filters).toEqual([["order_id", "qa-order"], ["application_status", "applied"]]);
  });

  it("leaves the generic online label when the order has no applied capture", async () => {
    state.rows.online_payment_order_lines = [{ receipt_id: "qa-receipt", order_id: "qa-order" }];
    state.rows.online_payment_captures = [
      { receipt_id: null, order_id: "qa-order", application_status: "review_required", method: "upi" },
    ];
    expect((await detail())?.onlineMethod).toBeNull();
  });

  it("does not select an arbitrary capture when an order has ambiguous applied captures", async () => {
    state.rows.online_payment_order_lines = [{ receipt_id: "qa-receipt", order_id: "qa-order" }];
    state.rows.online_payment_captures = [
      { receipt_id: null, order_id: "qa-order", application_status: "applied", method: "upi" },
      { receipt_id: null, order_id: "qa-order", application_status: "applied", method: "card" },
    ];
    expect((await detail())?.onlineMethod).toBeNull();
  });

  it("still renders the receipt when the optional fallback read fails", async () => {
    state.throwAt = "online_payment_order_lines";
    const result = await detail();
    expect(result?.id).toBe("qa-receipt");
    expect(result?.onlineMethod).toBeNull();
  });

  it("does not use service-role method lookup for an inaccessible receipt", async () => {
    state.visible = false;
    expect(await detail()).toBeNull();
    expect(state.requests).toEqual([]);
  });

  it("does not use service-role method lookup for a desk receipt", async () => {
    state.paymentMode = "upi";
    expect((await detail())?.onlineMethod).toBeNull();
    expect(state.requests).toEqual([]);
  });
});
