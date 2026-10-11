import { beforeEach, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ permission: vi.fn(), submissions: vi.fn(), cover: vi.fn(), remind: vi.fn(), session: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: state.session }));
vi.mock("@/vx/format", () => ({ schoolToday: () => "2026-10-11" }));
vi.mock("@/app/(app)/inbox/actions", () => ({ decideSubmissionsVx: state.submissions, assignCoverVx: state.cover }));
vi.mock("@/app/(app)/attendance/actions", () => ({ remindTeachersVx: state.remind }));
import { POST } from "@/app/api/inbox/route";
const id = "22222222-2222-4222-8222-222222222222", commandId = "11111111-1111-4111-8111-111111111111";
const scope = { accountId: "qa-account", sessionLabel: "QA-2026", day: "2026-10-11" };
const cases = [
  ["submissions", "collection:manage", { submissionIds: [id], accept: true }, "submissions"],
  ["remind", "attendance:mark_on_behalf", { classIds: [id] }, "remind"],
  ["cover", "substitutions:manage", { needKey: "qa-need", coveringStaffId: id, day: "2026-10-11", dayRevision: 4 }, "cover"],
] as const;
const request = (body: unknown) => new Request("https://qa.invalid/api/inbox", { method: "POST", body: JSON.stringify(body) }) as NextRequest;
beforeEach(() => { vi.resetAllMocks(); state.permission.mockResolvedValue({ id: "qa-actor", userId: scope.accountId }); state.session.mockResolvedValue(scope.sessionLabel); for (const fn of [state.submissions, state.cover, state.remind]) fn.mockResolvedValue({ ok: true }); });
it.each(cases)("departure of %s uses its own %s authority", async (kind, permission, body, action) => {
  state.permission.mockImplementation(async (actual: string) => { if (actual !== permission) throw new Error("QA unrelated permission revoked"); return { id: "qa-actor", userId: scope.accountId }; });
  const response = await POST(request({ kind, ...body, commandId, scope }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
  expect(state.permission).toHaveBeenCalledWith(permission); expect(state[action]).toHaveBeenCalledOnce();
});
it.each(cases)("refuses %s on expired authority before delegation", async (kind, _permission, body, action) => {
  state.permission.mockRejectedValue(new Error("QA expired"));
  expect((await POST(request({ kind, ...body, commandId, scope }))).status).toBe(403); expect(state[action]).not.toHaveBeenCalled();
});
it.each(cases)("does not acknowledge a refused %s action", async (kind, _permission, body, action) => {
  state[action].mockResolvedValue({ ok: false });
  expect((await POST(request({ kind, ...body, commandId, scope }))).status).toBe(422);
});
it.each(["account", "session", "day"])("refuses replay under a different %s", async (field) => {
  const wrong = { ...scope, ...(field === "account" ? { accountId: "qa-other" } : field === "session" ? { sessionLabel: "QA-other" } : { day: "2026-10-12" }) };
  expect((await POST(request({ kind: "submissions", submissionIds: [id], accept: true, commandId, scope: wrong }))).status).toBe(field === "account" ? 403 : 409);
  expect(state.submissions).not.toHaveBeenCalled();
});
it("passes the original command through replay", async () => {
  const body = { kind: "submissions", submissionIds: [id], accept: true, commandId, scope };
  await POST(request(body)); await POST(request(body));
  expect(state.submissions.mock.calls).toEqual([[[id], true, commandId], [[id], true, commandId]]);
});
it.each([null, { kind: "unknown" }, { kind: "correction", correctionId: id, approve: "true", commandId, scope }, { kind: "remind", classIds: [], commandId, scope }])("rejects malformed payload %j before authority or delegation", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(state.permission).not.toHaveBeenCalled();
});
it("a lost delegated response remains unacknowledged", async () => {
  state.submissions.mockRejectedValue(new Error("QA response lost"));
  expect((await POST(request({ kind: "submissions", submissionIds: [id], accept: true, commandId, scope }))).status).toBe(503);
});
