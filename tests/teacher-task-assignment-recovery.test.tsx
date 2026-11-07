// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssignmentLauncher } from "@/modules/teacher-tasks/ui/assignment-sheet";
import { ManageTask } from "@/modules/teacher-tasks/ui/manage-task";
import { ms } from "@/messages/setup";
import { PLAIN } from "@/modules/teacher-tasks/ui/plain";
import { CW } from "@/modules/teacher-tasks/ui/collect-words";
const calls=vi.hoisted(()=>({create:vi.fn(),delegate:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:calls.refresh,push:vi.fn()})}));
vi.mock("next/link",()=>({useLinkStatus:()=>({pending:false}),default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock("@/vx/ui/overlays",()=>({Sheet:({children,open}:{children:React.ReactNode;open:boolean})=>open?<div>{children}</div>:null}));
vi.mock("@/app/(app)/teach/tasks/actions",()=>({
  createTeacherTasksAction:calls.create,delegateTeacherTaskListAction:calls.delegate,
  taskAssignmentContextAction:async()=>({students:[{id:"child",name:"Synthetic child",classLabel:"QA",values:{},hasPhoto:false}],fields:[{id:"field",key:"phone",labelEn:"Phone",labelHi:"फोन"},{id:"portrait",key:"student_photo",labelEn:"Student photograph",labelHi:"फोटो"}],owners:[{id:"teacher",name:"Synthetic teacher"}],subjects:[],papers:[]}),
  previewTeacherTasksAction:async()=>({previewId:"preview",digest:"digest",dueDate:null,fields:["Phone"],groups:[{key:"class:qa",label:"QA",studentIds:["child"],teacherId:"teacher"}],students:[{id:"child",name:"Synthetic child",classLabel:"QA"}],blocked:[],unassigned:[]}),
  manageTeacherTaskAction:vi.fn(),restartTeacherTaskAction:vi.fn(),teacherTaskLinkAction:vi.fn(),
}));
let root:Root;let host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function click(label:string){
  const button=[...host.querySelectorAll("button")].find(b=>b.textContent?.startsWith(label));
  expect(button,label).toBeDefined();
  await act(async()=>{button!.click();await vi.dynamicImportSettled();});
}
it("links a refused create to the existing task and provides explicit list delegation",async()=>{
  calls.create.mockResolvedValue({ok:false,reason:"scope_changed",taskId:"existing-task"});
  await act(async()=>root.render(<AssignmentLauncher language="en" selectedIds={["child"]}/>));
  // Ask teachers is four questions now (D-522): "See who gets it", then "Give work to N teachers".
  await click(ms.taskAssign.en);await click(CW.seeWho.en);await click("Give work");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/inbox?view=collect&task=existing-task");
  expect(host.textContent).toContain(ms.taskScopeChanged.en);
  expect(host.textContent).not.toContain(PLAIN.created.en);
  await act(async()=>root.render(<ManageTask id="existing-task" language="en" collection/>));
  await click(PLAIN.reassign.en);
  const select=host.querySelector("select")!;
  await act(async()=>{select.value="teacher";select.dispatchEvent(new Event("change",{bubbles:true}));});
  await click(ms.taskDelegateList.en);
  expect(calls.delegate).toHaveBeenCalledWith("existing-task","teacher");
  expect(calls.create).toHaveBeenCalledTimes(1);
});
it("never offers common delegation for academic work",async()=>{
  await act(async()=>root.render(<ManageTask id="marks-task" language="en"/>));await click(PLAIN.reassign.en);
  expect(host.textContent).not.toContain(ms.taskDelegateList.en);
});
it("No photo preselects the photograph field in the existing assignment preview",async()=>{
  await act(async()=>root.render(<AssignmentLauncher language="en" selectedIds={["child"]} initialMissing="photo"/>));await click(ms.taskAssign.en);
  const label=[...host.querySelectorAll("label")].find(el=>el.textContent?.includes("Student photograph"));
  expect(label?.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(true);
});
it("opened for one child shows only that child and ticks only what is missing (smoke 20 Oct)",async()=>{
  await act(async()=>root.render(<AssignmentLauncher language="en" selectedIds={["child"]}/>));await click(ms.taskAssign.en);
  expect(host.textContent).toContain("Synthetic child · QA");
  expect(host.textContent).not.toContain(ms.taskSelectAll.en);
  expect(host.textContent).toContain("The details this child is missing are ticked above.");
  const phone=[...host.querySelectorAll("label")].find(el=>el.textContent?.includes("Phone"));
  expect(phone?.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(true);
});
