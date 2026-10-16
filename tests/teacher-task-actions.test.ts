import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),permission:vi.fn(),preview:vi.fn(),revalidate:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:mocks.permission,assertStaff:vi.fn()}));
vi.mock("@/vx/view-as",()=>({assertNotPreviewing:mocks.preview}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}));
vi.mock("@/modules/teacher-tasks/data/assignment",()=>({assignmentContext:vi.fn(),previewAssignment:vi.fn()}));
vi.mock("@/modules/teacher-tasks/data/repo",()=>({resolveTask:vi.fn()}));
vi.mock("@/modules/collection/data/requests-repo",()=>({resolveAssignedRequest:vi.fn()}));
vi.mock("@/modules/teacher-tasks/data/collection-save",()=>({submitCollectionPayload:vi.fn()}));
vi.mock("@/modules/teacher-tasks/data/save",()=>({saveTaskAcademicWork:vi.fn()}));
import { createTeacherTasksAction, delegateTeacherTaskListAction } from "@/app/(app)/teach/tasks/actions";
const id="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.clearAllMocks();mocks.permission.mockResolvedValue({id:"actor"});});
it("returns actionable scope refusal as data across the production Server Action boundary",async()=>{
  mocks.rpc.mockResolvedValue({error:{message:"tasks:scope_changed",details:id}});
  expect(await createTeacherTasksAction(id,"a".repeat(32))).toEqual({ok:false,reason:"scope_changed",taskId:id});
  expect(mocks.revalidate).not.toHaveBeenCalled();expect(mocks.permission).toHaveBeenCalledWith("collection:manage");
});
it("returns changed-recipient refusal and preserves unknown failures",async()=>{
  mocks.rpc.mockResolvedValueOnce({error:{message:"tasks:recipient_changed"}}).mockResolvedValueOnce({error:{message:"permission denied"}});
  expect(await createTeacherTasksAction(id,"a".repeat(32))).toEqual({ok:false,reason:"recipient_changed"});
  await expect(createTeacherTasksAction(id,"a".repeat(32))).rejects.toThrow("assignment_changed");
});
it("explicit delegation is permission checked and sends the existing task identity",async()=>{
  mocks.rpc.mockResolvedValue({error:null});await delegateTeacherTaskListAction(id,"teacher");
  expect(mocks.permission).toHaveBeenCalledWith("collection:manage");expect(mocks.preview).toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("delegate_teacher_task_list",{p_actor:"actor",p_id:id,p_teacher:"teacher"});
});
