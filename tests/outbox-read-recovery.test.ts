import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ errorAt: "", malformedFlags: false, withRecipient: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/env", () => ({ FEE_SCHEMA: "qa-fees" }));
vi.mock("@/modules/staff/data/staff-repo", () => ({ listStaff: async () => [] }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from, schema: () => ({ from }) }) }));
function from(table: string) {
  const query = { select: () => query, eq: () => query, in: () => query, is: () => query, gte: () => query, order: () => query, limit: () => query, returns: () => query,
    then: (resolve: (value: unknown) => void) => Promise.resolve({
      data: table === "parent_route_flags" && state.malformedFlags ? null : table === "message_sends" && state.withRecipient ? [{ id: "qa-send", student_id: "qa-child", campaign_id: "qa-campaign", to_phone: "9876543210", rendered_hi: "", rendered_en: "QA notice", status: "queued" }] : [],
      count: 0, error: state.errorAt === table ? { message: `QA ${table} unavailable` } : null,
    }).then(resolve),
  }; return query;
}
import { countOutbox, loadOutbox } from "@/vx/screens/messages/outbox-data";
beforeEach(() => { state.errorAt = ""; state.malformedFlags = false; state.withRecipient = false; });
it.each(["message_sends", "parent_message_queue"])("a failed %s count is unavailable, not zero", async (table) => { state.errorAt = table; await expect(countOutbox()).rejects.toThrow(); });
it.each(["message_sends", "parent_message_queue", "parent_route_flags", "calendar_notices", "fee_reminder_batches"])("a failed %s list cannot appear as Nothing to send", async (table) => { state.errorAt = table; await expect(loadOutbox()).rejects.toThrow(`QA ${table} unavailable`); });
it("missing flag data is unavailable rather than clearance to send", async () => { state.malformedFlags = true; await expect(loadOutbox()).rejects.toThrow(); });
it.each(["students", "message_campaigns"])("a failed chunked %s read cannot render a partial recipient list", async (table) => { state.withRecipient = true; state.errorAt = table; await expect(loadOutbox()).rejects.toThrow(`QA ${table} unavailable`); });
it("a genuine empty successful read remains empty", async () => { expect(await countOutbox()).toBe(0); expect(await loadOutbox()).toEqual({ items: [], more: 0, notices: [], batches: [] }); });
