import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ errorAt: "", requests: [] as { table: string; filters: [string, unknown][]; ids: string[] }[], paymentCount: 1, page: vi.fn(), detail: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const request = { table, filters: [] as [string, unknown][], ids: [] as string[] }; state.requests.push(request);
  const query = {
    select: () => query, order: () => query, limit: () => query,
    eq: (key: string, value: unknown) => { request.filters.push([key, value]); return query; },
    lte: (key: string, value: unknown) => { request.filters.push([key, value]); return query; },
    in: (_key: string, ids: string[]) => { request.ids = ids; return query; },
    then: (resolve: (value: unknown) => void) => {
      const error = state.errorAt === table ? { message: `QA ${table} unavailable` } : null;
      const data = table === "receipts" ? [{ id: "qa-receipt", payment_date: "2026-10-10" }] : table === "payments" ? Array.from({ length: state.paymentCount }, (_, i) => ({ id: `qa-payment-${i}` })) : [];
      return Promise.resolve({ data, error }).then(resolve);
    },
  }; return query;
} }) }));
vi.mock("@/modules/receipts/data/queries", () => ({ getReceiptsPage: state.page, getReceiptDetail: state.detail }));
import { getDeskReceipt, lastReceiptDate, loadDeskReceipts } from "@/modules/receipts/vx/data";
beforeEach(() => {
  vi.clearAllMocks(); state.errorAt = ""; state.requests = []; state.paymentCount = 1;
  state.detail.mockResolvedValue({ id: "qa-receipt", createdAt: "2026-10-10T10:00:00Z", totalAmount: 100, reversedAmount: 0 });
});
it.each(["receipts", "payments", "whatsapp_reminder_sends", "payment_adjustments"])("does not render missing %s history as an empty success", async (table) => {
  state.errorAt = table;
  await expect(getDeskReceipt("QA-1")).rejects.toThrow(`QA ${table} unavailable`);
});
it("reads every payment line in bounded filters instead of truncating reversal history at 50", async () => {
  state.paymentCount = 401;
  await getDeskReceipt("QA-1");
  const reads = state.requests.filter(r => r.table === "payment_adjustments");
  expect(reads.map(r => r.ids.length)).toEqual([200, 200, 1]);
  expect(new Set(reads.flatMap(r => r.ids)).size).toBe(401);
});
it("scopes the previous receipt day to the chosen session", async () => {
  await lastReceiptDate("2026-10-10", "QA-2026-27");
  expect(state.requests[0].filters).toContainEqual(["session_label", "QA-2026-27"]);
});
it("refuses a failed previous-day read", async () => {
  state.errorAt = "receipts";
  await expect(lastReceiptDate("2026-10-10", "QA-2026-27")).rejects.toThrow();
});
it.each([500, 501])("reports the bounded %i receipt read truthfully", async (count) => {
  state.page.mockImplementation(async (_query, pagination) => ({ totalCount: count, receipts: Array.from({ length: Math.min(100, Math.max(0, count - (pagination.page - 1) * 100)) }, (_, i) => ({ id: `qa-${pagination.page}-${i}` })) }));
  const result = await loadDeskReceipts("QA-2026-27", "2026-10-10", "2026-10-10");
  expect(result.rows).toHaveLength(500);
  expect(result.truncated).toBe(count > 500);
  expect(state.page).toHaveBeenCalledTimes(5);
});
