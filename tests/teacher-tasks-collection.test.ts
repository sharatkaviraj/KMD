import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { roll, write, rpc } = vi.hoisted(() => ({ roll: vi.fn(), write: vi.fn(), rpc:vi.fn() }));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({rpc})}));
vi.mock("@/modules/collection/data/requests-repo", () => ({ rollForRequest: roll }));
vi.mock("@/modules/collection/data/submissions-repo", () => ({ recordAnswers: write }));
import { submitCollectionPayload } from "@/modules/teacher-tasks/data/collection-save";
import type { CollectionRequest } from "@/modules/collection/domain/requests";

const request = { id: "request", fields: [{ id: "field", key: "note", labelEn: "Note", labelHi: "Note", inputType: "text", exactLen: null, pattern: null, maxValue: null, options: null }] } as CollectionRequest;
beforeEach(() => {
  write.mockReset(); write.mockResolvedValue({ written: 1 });
  rpc.mockReset();rpc.mockResolvedValue({data:{ok:true},error:null});
  roll.mockResolvedValue([{ studentId: "child", current: { note: "official snapshot" } }]);
});
it("writes task proposals atomically with the original actor/capability and pinned request generation",async()=>{
  const auth={id:"task",token:"original-task-token"};
  await submitCollectionPayload(request,[{studentId:"child",key:"note",value:"proposal"}],auth);
  expect(rpc).toHaveBeenCalledWith("save_teacher_task",expect.objectContaining({p_id:"task",p_staff:null,p_token:"original-task-token",p:expect.objectContaining({kind:"collection",request_id:request.id,request_token:request.token})}));
  expect(write).not.toHaveBeenCalled();
  rpc.mockResolvedValue({data:{ok:false,reason:"not_permitted"},error:null});
  expect((await submitCollectionPayload(request,[],auth)).status).toBe("error");
});
it("uses the shared request handler to save proposals with the frozen previous value", async () => {
  expect((await submitCollectionPayload(request, [{ studentId: "child", key: "note", value: "new proposal" }])).status).toBe("saved");
  expect(write).toHaveBeenCalledWith(request, [{ studentId: "child", fieldId: "field", value: "new proposal", previousValue: "official snapshot" }]);
});
it("rejects the whole batch when a child or field is outside the task", async () => {
  expect((await submitCollectionPayload(request, [{ studentId: "child", key: "note", value: "valid" }, { studentId: "other", key: "note", value: "outside" }])).status).toBe("error");
  expect((await submitCollectionPayload(request, [{ studentId: "child", key: "other", value: "outside" }])).status).toBe("error");
  expect(write).not.toHaveBeenCalled();
});
it("does not claim success when current authority or the canonical writer refuses", async () => {
  write.mockRejectedValue(new Error("revoked"));
  expect((await submitCollectionPayload(request, [{ studentId: "child", key: "note", value: "proposal" }])).status).toBe("error");
});
