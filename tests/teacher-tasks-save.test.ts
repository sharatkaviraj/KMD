import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
import { saveTaskAcademicWork } from "@/modules/teacher-tasks/data/save";
const id = "10000000-0000-4000-8000-000000000001";
const paper = "10000000-0000-4000-8000-000000000002";
beforeEach(() => rpc.mockReset());
it("sends a validated marks command with task authority to the canonical audited wrapper", async () => {
  rpc.mockResolvedValue({ data: { ok: true, revision: 1 }, error: null });
  const result = await saveTaskAcademicWork({ id, staffId: id }, { kind: "marks", payload: { commandId: id, paperId: paper, kind: "submit", expectedRevision: 0, reason: null, entries: [{ studentId: id, state: "value", value: 0 }] } });
  expect(result.ok).toBe(true);
  const command = rpc.mock.calls[0];
  expect(command[0]).toBe("save_teacher_task");
  expect(command[1]).toMatchObject({ p_id: id, p_staff: id, p_token: null, p: { paper_id: paper, kind: "submit", entries: [{ student_id: id, state: "value", value: 0 }] } });
});
it("public attendance and login carry identical canonical payloads with separate credentials", async () => {
  rpc.mockResolvedValue({ data: { ok: true, revision: 1 }, error: null });
  const work = { kind: "attendance" as const, session: "test", payload: { commandId: id, classId: paper, day: "2026-10-16", kind: "save", expectedRevision: 0, reason: null, marks: [{ studentId: id, status: "present" }] } };
  await saveTaskAcademicWork({ id, staffId: id }, work);
  await saveTaskAcademicWork({ id, token: "synthetic-token" }, work);
  expect(rpc.mock.calls[0][1].p).toEqual(rpc.mock.calls[1][1].p);
  expect(rpc.mock.calls[1][1]).toMatchObject({ p_staff: null, p_token: "synthetic-token" });
});
it("rejects malformed entries and office-only reopening before calling a writer", async () => {
  expect((await saveTaskAcademicWork({ id, staffId: id }, { kind: "marks", payload: { paperId: paper, kind: "reopen" } })).ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});
it("does not report revoked, stale or locked writes as successful", async () => {
  rpc.mockResolvedValue({ data: { ok: false, reason: "not_permitted" }, error: null });
  const r = await saveTaskAcademicWork({ id, token: "revoked" }, { kind: "marks", payload: { commandId: id, paperId: paper, kind: "draft", expectedRevision: 0, entries: [] } });
  expect(r).toMatchObject({ ok: false });
});
