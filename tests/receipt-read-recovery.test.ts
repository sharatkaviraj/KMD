import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ errorAt: "", requests: [] as { table: string; columns: string; filters: [string, unknown][]; ids: string[] }[], paymentCount: 1, page: vi.fn(), detail: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const request = { table, columns: "", filters: [] as [string, unknown][], ids: [] as string[] }; state.requests.push(request);
  const query = {
    select: (columns: string) => { request.columns = columns; return query; }, order: () => query, limit: () => query,
    eq: (key: string, value: unknown) => { request.filters.push([key, value]); return query; },
    lte: (key: string, value: unknown) => { request.filters.push([key, value]); return query; },
    in: (_key: string, ids: string[]) => { request.ids = ids; return query; },
    then: (resolve: (value: unknown) => void) => {
      // Schema metadata from schoolfees-dev: receipts has no session_label.
      // Reject the invalid query instead of letting a permissive mock pass it.
      const invalidColumn = table === "receipts" && request.filters.some(([key]) => key === "session_label");
      const error = invalidColumn ? { message: "column receipts.session_label does not exist", code: "42703" } : state.errorAt === table ? { message: `QA ${table} unavailable` } : null;
      const session = request.filters.find(([key]) => key === "payments.installment_ref.class_ref.session_label")?.[1];
      const data = table === "receipts" ? session === "QA-EMPTY" ? [] : [{ id: "qa-receipt", payment_date: "2026-10-10" }] : table === "payments" ? Array.from({ length: state.paymentCount }, (_, i) => ({ id: `qa-payment-${i}` })) : [];
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
  await expect(lastReceiptDate("2026-10-10", "QA-2026-27")).resolves.toBe("2026-10-10");
  expect(state.requests[0].filters).toContainEqual(["payments.installment_ref.class_ref.session_label", "QA-2026-27"]);
  expect(state.requests[0].filters).toContainEqual(["payment_date", "2026-10-10"]);
  expect(state.requests[0].columns).toContain("payments!inner(installment_ref:installments!inner(class_ref:classes!inner(session_label)))");
});
it("does not fall back to another session when the chosen session has no receipts", async () => {
  await expect(lastReceiptDate("2026-10-10", "QA-EMPTY")).resolves.toBeNull();
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
