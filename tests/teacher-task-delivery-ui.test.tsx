// @vitest-environment jsdom
import * as React from "react";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const calls=vi.hoisted(()=>({preview:vi.fn(),confirm:vi.fn(),reconcile:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/app/(app)/teach/tasks/delivery-actions",()=>({previewTaskDeliveryAction:calls.preview,confirmTaskDeliveryAction:calls.confirm,reconcileTaskDeliveryAction:calls.reconcile}));
import {TaskDelivery} from "@/modules/teacher-tasks/ui/task-delivery";
let host:HTMLDivElement;let root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("an interrupted send recovers immediately after attributed not-sent reconciliation",async()=>{
  const summary={pending:true,deliveries:[]} as import("@/modules/teacher-tasks/domain/delivery").DeliverySummary;
  const render=()=>root.render(<TaskDelivery id="task" language="en" availability="ready" summary={summary}/>);
  calls.preview.mockResolvedValue({ok:true,id:"preview",digest:"digest",name:"Synthetic Teacher",phone:"9000000000",title:"Synthetic task"});
  calls.confirm.mockRejectedValue(new Error("finish response lost"));calls.reconcile.mockResolvedValue(true);
  const click=async(label:string)=>act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent===label)!.click());
  await act(async()=>render());await click("Review message");await click("Send through AiSensy");
  summary.deliveries=[{id:"send",state:"unknown",transport:"aisensy",phone:"9000000000",at:"2026-10-16",round:"initial",attempt:"attempt:synthetic",history:[]}];
  await act(async()=>render());
  await act(async()=>{const input=host.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Verified synthetic provider log: no send");input.dispatchEvent(new Event("input",{bubbles:true}));});
  await click("Confirm not sent in log");summary.deliveries=[];await act(async()=>render());
  expect(host.textContent).toContain("Review message");await click("Review message");expect(calls.preview).toHaveBeenCalledTimes(2);
});
it("shows the actual reviewed number and a typed changed-recipient refusal",async()=>{
  calls.preview.mockResolvedValue({ok:true,id:"preview",digest:"digest",name:"Synthetic Teacher",phone:"9000000000",title:"Synthetic task",due:null,kind:"initial",expected:1,answered:0});
  calls.confirm.mockResolvedValue({ok:false,reason:"changed"});
  await act(async()=>root.render(<TaskDelivery id="task" language="en" availability="ready" summary={{pending:true,deliveries:[]}}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("+91 9000000000");
  const send=[...host.querySelectorAll("button")].find(b=>b.textContent==="Send through AiSensy")!;
  await act(async()=>send.click());expect(host.textContent).toContain("changed");expect(host.textContent).not.toContain("Accepted by AiSensy");
});
it("unknown blocks ordinary API/manual resend and exposes attributed reconciliation controls",async()=>{
  await act(async()=>root.render(<TaskDelivery id="task" language="en" availability="ready" summary={{pending:true,deliveries:[{id:"send",state:"unknown",transport:"aisensy",phone:"9000000000",at:"2026-10-16",round:"initial",attempt:"attempt:synthetic",history:[]}]}}/>));
  expect(host.textContent).toContain("Check the provider log");expect(host.textContent).not.toContain("Review message");expect(host.textContent).not.toContain("Prepare WhatsApp link");
});
it("shows the exact recipient-language body once even when the office reads both languages",async()=>{
  calls.preview.mockResolvedValue({ok:true,id:"preview",digest:"digest",name:"Synthetic Teacher",phone:"9000000000",title:"Synthetic task",due:null,kind:"initial",language:"en",textHi:"Exact recipient wording.",textEn:"Exact recipient wording."});
  await act(async()=>root.render(<TaskDelivery id="task" language="both" availability="ready" summary={{pending:true,deliveries:[]}}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent?.match(/Exact recipient wording\./g)).toHaveLength(1);
});
it("shows actual student count and requested fields separately from answer slots",async()=>{
  calls.preview.mockResolvedValue({ok:true,id:"preview",digest:"digest",name:"Synthetic Teacher",phone:"9000000000",title:"Synthetic task",due:"2026-10-20",expected:4,answered:0,studentCount:2,fields:[{id:"field-photo",hi:"चित्र",en:"Portrait"},{id:"field-note",hi:"टिप्पणी",en:"Contact note"}],scope:{session:"QA",classLabel:null,subject:null,day:null}});
  await act(async()=>root.render(<TaskDelivery id="task" language="en" availability="unavailable" summary={{pending:true,deliveries:[]}}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("Students: 2");expect(host.textContent).not.toContain("Students: 4");
  expect(host.textContent).toContain("Requested fields");expect(host.textContent).toContain("Portrait");expect(host.textContent).toContain("Contact note");expect(host.textContent).toContain("2026-10-20");
});
it.each(["marks","attendance"])("shows the frozen academic %s scope",async(kind)=>{
  calls.preview.mockResolvedValue({ok:true,id:"preview",digest:"digest",name:"Synthetic Teacher",phone:"9000000000",title:"Synthetic task",studentCount:24,fields:[],scope:{session:"QA",classLabel:"Synthetic class A",subject:kind==="marks"?{hi:"गणित",en:"Synthetic Maths"}:null,day:kind==="attendance"?"2026-10-16":null}});
  await act(async()=>root.render(<TaskDelivery id="task" language="en" availability="ready" summary={{pending:true,deliveries:[]}}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("Students: 24");expect(host.textContent).toContain("Synthetic class A");expect(host.textContent).toContain("QA");
  expect(host.textContent).toContain(kind==="marks"?"Synthetic Maths":"2026-10-16");
});
it("dev mock and a manual handoff are never described as accepted or delivered",async()=>{
  await act(async()=>root.render(<TaskDelivery id="task" language="hi" availability="test_mode" summary={{pending:false,deliveries:[{id:"send",state:"manual_opened",transport:"manual",phone:"9000000000",at:"2026-10-16",round:"initial",attempt:null,history:[]}]}}/>));
  expect(host.textContent).not.toMatch(/Accepted|Delivered/);expect(host.querySelector("button")).toBeNull();
});
