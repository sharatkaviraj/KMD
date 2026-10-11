import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ permission: vi.fn(), preview: vi.fn(), errorAt: "", flag: false, missingFlags: false, flags: [] as { phone: string }[], flagRanges: [] as number[], writes: [] as { table: string; patch: Record<string, unknown>; filters: [string, unknown][] }[], zeroUpdate: false, status: "queued", stale: false }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: state.preview }));
vi.mock("@/platform/env", () => ({ FEE_SCHEMA: "qa-fees" }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ schema: () => ({ from }), from }) }));
function from(table: string) {
  let patch: Record<string, unknown> | null = null;
  let start = 0; let end = 199;
  const filters: [string, unknown][] = [];
  const value = () => ({ data: patch ? (state.zeroUpdate ? [] : [{ id: ID }]) : table === "parent_route_flags" ? (state.missingFlags ? null : state.flag ? [{ phone: "9876543210" }] : state.flags.slice(start, end + 1)) : {
    id: ID, student_id: "qa-child", status: state.status, stale_at: state.stale ? "2026-10-10T00:00:00Z" : null,
    to_phone: "9876543210", guardian_phone: "9876543210", primary_phone: null, rendered_hi: "", rendered_en: "QA notice", body_hi: "QA notice", body_en: "", sent_at: new Date().toISOString(),
  }, error: state.errorAt === table ? { message: "QA read unavailable" } : null });
  const query = {
    select: () => query, order: () => query, range: (a: number, b: number) => { start = a; end = b; if (table === "parent_route_flags") state.flagRanges.push(a); return query; },
    eq: (key: string, val: unknown) => { filters.push([key, val]); return query; },
    is: (key: string, val: unknown) => { filters.push([key, val]); return query; },
    in: (key: string, val: unknown) => { filters.push([key, val]); return query; },
    update: (input: Record<string, unknown>) => { patch = input; state.writes.push({ table, patch: input, filters }); return query; },
    maybeSingle: async () => value(), returns: () => query,
    then: (resolve: (input: unknown) => void) => Promise.resolve(value()).then(resolve),
  }; return query;
}
import { sendByHandAction, undoSentAction } from "@/app/(app)/messages/outbox-actions";
const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.clearAllMocks(); state.errorAt = ""; state.flag = false; state.missingFlags = false; state.flags = []; state.flagRanges = []; state.writes = []; state.zeroUpdate = false; state.status = "queued"; state.stale = false; state.permission.mockResolvedValue({ id: "qa-staff" }); state.preview.mockResolvedValue(undefined); });
it.each(["send", "queue"])("opening %s produces a link without claiming or recording a send", async (source) => {
  const result = await sendByHandAction({ source, id: ID });
  expect(result.ok).toBe(true); if (result.ok) expect(result.link).toMatch(/^https:\/\/wa.me\//);
  expect(state.writes).toHaveLength(0);
});
it.each(["send", "queue"])("a failed wrong-number flag read refuses %s and writes nothing", async (source) => {
  state.errorAt = "parent_route_flags";
  expect((await sendByHandAction({ source, id: ID })).ok).toBe(false); expect(state.writes).toHaveLength(0);
});
it.each(["send", "queue"])("a reported wrong number refuses %s even after explicit confirmation", async (source) => {
  state.flag = true;
  expect((await sendByHandAction({ source, id: ID, confirmed: true })).ok).toBe(false); expect(state.writes).toHaveLength(0);
});
it.each(["send", "queue"])("explicit confirmation records %s with a conditional status update, without reopening WhatsApp", async (source) => {
  const result = await sendByHandAction({ source, id: ID, confirmed: true });
  expect(result.ok).toBe(true); if (result.ok) expect(result.link).toBeUndefined();
  expect(state.writes).toHaveLength(1); expect(state.writes[0].patch.status).toBe("sent");
  expect(state.writes[0].filters).toContainEqual(["id", ID]);
  expect(state.writes[0].filters.some(([key]) => key === "status")).toBe(true);
});
it.each(["send", "queue"])("does not claim a concurrent %s cancellation was confirmed", async (source) => {
  state.zeroUpdate = true;
  expect((await sendByHandAction({ source, id: ID, confirmed: true })).ok).toBe(false);
});
it.each(["send", "queue"])("an already sent %s is not handed off again", async (source) => {
  state.status = "sent";
  expect((await sendByHandAction({ source, id: ID })).ok).toBe(false); expect(state.writes).toHaveLength(0);
});
it("refuses a stale notice", async () => { state.stale = true; expect((await sendByHandAction({ source: "send", id: ID })).ok).toBe(false); expect(state.writes).toHaveLength(0); });
it.each(["permission", "preview"] as const)("the %s guard prevents even a handoff read", async (guard) => {
  state[guard].mockRejectedValue(new Error("QA denied"));
  await expect(sendByHandAction({ source: "send", id: ID })).rejects.toThrow(); expect(state.writes).toHaveLength(0);
});
it("undo refuses a zero-row competing transition", async () => { state.status = "sent"; state.zeroUpdate = true; expect((await undoSentAction({ source: "send", id: ID })).ok).toBe(false); });
it("missing flag data does not authorize the handoff", async () => { state.missingFlags = true; expect((await sendByHandAction({ source: "send", id: ID })).ok).toBe(false); expect(state.writes).toHaveLength(0); });
it("a flag beyond the first page still prevents a handoff", async () => {
  state.flags = [...Array.from({ length: 200 }, () => ({ phone: "0000000000" })), { phone: "9876543210" }];
  expect((await sendByHandAction({ source: "send", id: ID })).ok).toBe(false); expect(state.flagRanges).toEqual([0, 200]); expect(state.writes).toHaveLength(0);
});
it("undo protects the exact sent timestamp and never undoes an automated send", async () => {
  state.status = "sent"; expect((await undoSentAction({ source: "send", id: ID })).ok).toBe(true);
  expect(state.writes[0].filters).toContainEqual(["provider_message_id", null]);
  expect(state.writes[0].filters.some(([key, value]) => key === "sent_at" && typeof value === "string")).toBe(true);
});
