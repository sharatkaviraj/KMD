import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown> }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let patch: Record<string, unknown> = {}; const filters: ((r: Record<string, unknown>) => boolean)[] = [];
  const q = {
    insert: async () => ({ error: null }), update(p: Record<string, unknown>) { patch = p; return q; },
    select() { return q; }, eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
    is(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
    in(k: string, values: unknown[]) { filters.push(r => values.includes(r[k])); return q; },
    then(resolve: (v: unknown) => void) {
      const match = table === "message_sends" && filters.every(f => f(state.row)); if (match) Object.assign(state.row, patch);
      return Promise.resolve(resolve({ data: match ? [{ id: "qa-send" }] : [], error: null }));
    },
  }; return q;
} }) }));
import { flagRoute } from "@/modules/collection/data/parent-messages-repo";
beforeEach(() => { state.row = { status: "queued", to_phone: "9876543210", provider_message_id: null }; });
const flag = () => flagRoute({ phone: "9876543210", studentId: null, reason: "QA wrong route", actorStaffId: "qa-actor" });
it("withdraws a queued message which has never reached transport", async () => {
  expect(await flag()).toEqual({ withdrawn: 1 }); expect(state.row.status).toBe("cancelled");
});
it.each(["attempt:qa-unknown", null])("keeps unknown failed delivery visible with its existing evidence: %s", async providerId => {
  state.row.status = "failed"; state.row.provider_message_id = providerId; state.row.error = "QA lost response";
  expect(await flag()).toEqual({ withdrawn: 0 }); expect(state.row.status).toBe("failed");
  expect(state.row.error).toBe("QA lost response"); expect(state.row.provider_message_id).toBe(providerId);
});
