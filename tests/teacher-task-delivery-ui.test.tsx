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
it("dev mock and a manual handoff are never described as accepted or delivered",async()=>{
  await act(async()=>root.render(<TaskDelivery id="task" language="hi" availability="test_mode" summary={{pending:false,deliveries:[{id:"send",state:"manual_opened",transport:"manual",phone:"9000000000",at:"2026-10-16",round:"initial",attempt:null,history:[]}]}}/>));
  expect(host.textContent).not.toMatch(/Accepted|Delivered/);expect(host.querySelector("button")).toBeNull();
});
