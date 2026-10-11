import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ permission: vi.fn(), preview: vi.fn(), queue: vi.fn(), noticeQueue: vi.fn(), updateError: false, zeroUpdate: false, readsFail: false, writes: [] as { table: string; filters: [string, unknown][] }[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: state.preview }));
vi.mock("@/platform/env", () => ({ FEE_SCHEMA: "qa-fees" }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ schema: () => ({ from }), from }) }));
vi.mock("@/vx/screens/messages/queue", () => ({
  queueCampaign: state.queue, queueNotice: state.noticeQueue, templateId: async () => "qa-template", generalPolicyVersion: async () => "qa-policy",
  NOTICE_TEMPLATE: { parent: "qa-parent" }, parentSendRow: (row: unknown) => row,
}));
function from(table: string) {
  let updating = false;
  const filters: [string, unknown][] = [];
  const query = {
    select: () => query, eq: (key: string, val: unknown) => { filters.push([key, val]); return query; },
    in: (key: string, val: unknown) => { filters.push([key, val]); return query; }, gt: () => query,
    update: () => { updating = true; state.writes.push({ table, filters }); return query; },
    maybeSingle: async () => ({ error: null, data: table === "calendar_notices" ? {
      id: ID, session_label: "QA-2026-27", holiday_day: null, audience: "school", rendered_hi: "", rendered_en: "QA notice", status: "awaiting_approval", calendar_events: null,
    } : { id: ID, session_label: "QA-2026-27", name: "QA batch", template: "gentle", language: "en", audience_line: null, student_ids: [ID], status: "queued" } }),
    then: (resolve: (value: unknown) => void) => Promise.resolve(updating
      ? { data: state.zeroUpdate ? [] : [{ id: ID }], error: state.updateError ? { message: "QA write failed" } : null }
      : { data: [{ student_id: ID, student_name: "QA child", father_name: "QA family", father_phone: "9876543210", due_date: "2026-01-01", pending_amount: 500 }], error: state.readsFail ? { message: "QA balances unavailable" } : null }).then(resolve),
  };
  return query;
}
import { approveCalendarNoticeAction, declineCalendarNoticeAction, prepareReminderBatchAction } from "@/app/(app)/messages/outbox-actions";
const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks(); state.updateError = false; state.zeroUpdate = false; state.readsFail = false; state.writes = [];
  state.permission.mockResolvedValue({ id: "qa-staff" });
  state.queue.mockResolvedValue({ ok: true, count: 1, campaignId: ID }); state.noticeQueue.mockResolvedValue({ ok: true, count: 1, campaignId: ID });
});
it.each(["error", "zero"])("notice approval cannot claim success after an %s final transition", async (failure) => {
  state.updateError = failure === "error"; state.zeroUpdate = failure === "zero";
  const result = await approveCalendarNoticeAction(ID);
  expect(state.noticeQueue).toHaveBeenCalled(); expect(result.ok).toBe(false);
  expect(result.message.en).toMatch(/queued|ready/i); expect(result.message.en).toMatch(/reload/i);
});
it.each(["error", "zero"])("notice decline cannot claim no send after an %s transition", async (failure) => {
  state.updateError = failure === "error"; state.zeroUpdate = failure === "zero";
  expect((await declineCalendarNoticeAction(ID)).ok).toBe(false); expect(state.noticeQueue).not.toHaveBeenCalled();
});
it.each(["error", "zero"])("fee batch preparation cannot claim complete after an %s final transition", async (failure) => {
  state.updateError = failure === "error"; state.zeroUpdate = failure === "zero";
  const result = await prepareReminderBatchAction(ID);
  expect(state.queue).toHaveBeenCalled(); expect(result.ok).toBe(false);
  expect(result.message.en).toMatch(/queued|ready/i); expect(result.message.en).toMatch(/reload/i);
});
it("failed fee balances cannot prepare a campaign", async () => {
  state.readsFail = true; expect((await prepareReminderBatchAction(ID)).ok).toBe(false); expect(state.queue).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0);
});
it("notice retry uses the same audience request id", async () => {
  await approveCalendarNoticeAction(ID); await approveCalendarNoticeAction(ID);
  const keys = state.noticeQueue.mock.calls.map(([input]) => input.clientRequestId);
  expect(new Set(keys).size).toBe(1);
});
