import { beforeEach, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ permission: vi.fn(), correction: vi.fn(), submissions: vi.fn(), cover: vi.fn(), remind: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/app/(app)/inbox/actions", () => ({ decideCorrectionVx: state.correction, decideSubmissionsVx: state.submissions, assignCoverVx: state.cover }));
vi.mock("@/app/(app)/attendance/actions", () => ({ remindTeachersVx: state.remind }));
import { POST } from "@/app/api/inbox/route";
const cases = [
  ["correction", "attendance:correct", { correctionId: "qa-correction", approve: true }, "correction"],
  ["submissions", "collection:manage", { submissionIds: ["qa-submission"], accept: true }, "submissions"],
  ["remind", "attendance:mark_on_behalf", { classIds: ["qa-class"] }, "remind"],
  ["cover", "substitutions:manage", { commandId: "qa-command", needKey: "qa-need", coveringStaffId: "qa-staff", day: "2026-10-10", dayRevision: 4 }, "cover"],
] as const;
const request = (body: unknown) => new Request("https://qa.invalid/api/inbox", { method: "POST", body: JSON.stringify(body) }) as NextRequest;
beforeEach(() => { vi.resetAllMocks(); for (const fn of [state.correction, state.submissions, state.cover, state.remind]) fn.mockResolvedValue({ ok: true }); });
it.each(cases)("departure of %s uses its own %s authority", async (kind, permission, body, action) => {
  state.permission.mockImplementation(async (actual: string) => { if (actual !== permission) throw new Error("QA unrelated permission revoked"); });
  const response = await POST(request({ kind, ...body }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
  expect(state.permission).toHaveBeenCalledWith(permission); expect(state[action]).toHaveBeenCalledOnce();
});
it.each(cases)("refuses %s before delegation on expired or denied authority", async (kind, _permission, body, action) => {
  state.permission.mockRejectedValue(new Error("QA expired"));
  expect((await POST(request({ kind, ...body }))).status).toBe(403); expect(state[action]).not.toHaveBeenCalled();
});
it.each(cases)("does not acknowledge a refused %s action", async (kind, _permission, body, action) => {
  state[action].mockResolvedValue({ ok: false });
  const response = await POST(request({ kind, ...body })); expect(response.status).toBe(422); expect(await response.json()).toEqual({ ok: false });
});
it("rejects malformed and unknown payloads without invoking an action", async () => {
  expect((await POST(request(null))).status).toBe(400);
  expect((await POST(request({ kind: "unknown" }))).status).toBe(400);
  expect(state.permission).not.toHaveBeenCalled();
});
it("does not acknowledge a lost delegated response", async () => {
  state.correction.mockRejectedValue(new Error("QA response lost"));
  expect((await POST(request({ kind: "correction", correctionId: "qa-correction", approve: true }))).status).toBe(422);
});
