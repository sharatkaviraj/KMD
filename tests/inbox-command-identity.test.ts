import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ permission: vi.fn(), submissions: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: vi.fn() }));
vi.mock("@/app/(app)/collection/actions", () => ({ decideSubmissionsAction: state.submissions }));
vi.mock("@/app/(app)/substitutions/actions", () => ({ coverCommandAction: vi.fn() }));
import { decideSubmissionsVx } from "@/app/(app)/inbox/actions";
const command = "11111111-1111-4111-8111-111111111111", submission = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { vi.resetAllMocks(); state.permission.mockResolvedValue({ id: "qa-actor" }); state.submissions.mockResolvedValue({ status: "saved" }); });
it("submission delivery passes the same command on every retry", async () => {
  await decideSubmissionsVx([submission], true, command); await decideSubmissionsVx([submission], true, command);
  expect(state.submissions.mock.calls.map(c => c[1].get("commandId"))).toEqual([command, command]);
});
it("expired authority refuses mutation", async () => {
  state.permission.mockRejectedValue(new Error("QA expired"));
  await expect(decideSubmissionsVx([submission], true, command)).rejects.toThrow(); expect(state.submissions).not.toHaveBeenCalled();
});
it("refuses a malformed replay identity before mutation", async () => {
  expect(await decideSubmissionsVx([submission], true, "QA-invalid")).toMatchObject({ ok: false }); expect(state.submissions).not.toHaveBeenCalled();
});
