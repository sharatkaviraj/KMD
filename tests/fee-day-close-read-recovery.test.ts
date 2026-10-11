import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ count: 1, failOffset: -1, pendingError: false, ranges: [] as [number, number][], filters: [] as [string, unknown][] }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => { throw new Error("A read must not use a write client"); } }));
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let start = 0; let end = 199;
  const query = { select: () => query, order: () => query, limit: () => query,
    gte: () => query, lte: () => query,
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return query; },
    range: (a: number, b: number) => { start = a; end = b; state.ranges.push([a, b]); return query; },
    then: (resolve: (value: unknown) => void) => Promise.resolve({
      data: table === "fee_desk_requests" ? [] : Array.from({ length: Math.max(0, Math.min(end + 1, state.count) - start) }, (_, offset) => ({
        id: `qa-event-${start + offset}`, payment_date: "2026-10-10", action: start + offset === state.count - 1 ? "reopen" : "close", cash_expected: 0, cash_counted: 0, upi_checked: false, receipt_count: 0, reversed_count: 0, expected: {}, note: "QA history", actor_name: "QA desk", created_at: `2026-10-10T${start + offset === state.count - 1 ? "11" : "10"}:00:00Z`,
      })), error: (table === "fee_desk_requests" && state.pendingError) || (table === "fee_day_close_events" && start === state.failOffset) ? { message: "QA history unavailable" } : null,
    }).then(resolve),
  }; return query;
} }) }));
import { listCloseEvents, pendingReversalRequest } from "@/vx/screens/receipts/data";
import { latestCloseState } from "@/modules/receipts/vx/domain/day-close";
beforeEach(() => { state.count = 1; state.failOffset = -1; state.pendingError = false; state.ranges = []; state.filters = []; });
it.each([201, 1001])("reads the latest reopen beyond the %i history rows without crossing sessions", async (count) => {
  state.count = count;
  const events = await listCloseEvents("2026-10-10", "2026-10-10", { strict: true, sessionLabel: "QA-2026-27" });
  expect(events).toHaveLength(count); expect(latestCloseState(events).closed).toBe(false);
  expect(state.ranges).toHaveLength(Math.ceil(count / 200));
  expect(state.filters.filter(([key]) => key === "session_label").every(([, value]) => value === "QA-2026-27")).toBe(true);
});
it("a later failed page never returns a plausible partial close history", async () => {
  state.count = 201; state.failOffset = 200;
  await expect(listCloseEvents("2026-10-10", "2026-10-10", { strict: true, sessionLabel: "QA-2026-27" })).rejects.toThrow("QA history unavailable");
});
it("a failed pending-reversal read cannot appear as no request", async () => { state.pendingError = true; await expect(pendingReversalRequest("qa-receipt")).rejects.toThrow("QA history unavailable"); });
it("a genuine empty pending request stays empty", async () => { expect(await pendingReversalRequest("qa-receipt")).toBeNull(); });
