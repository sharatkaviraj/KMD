// @vitest-environment jsdom
import * as React from "react";
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import type {MessageTemplate} from "@/modules/collection/domain/messages";
vi.mock("@/app/(app)/collection/actions",()=>({queueMessageAction:vi.fn()}));
vi.mock("@/platform/i18n/use-language",()=>({useLanguage:()=>"en"}));
import {QueueMessageForm} from "@/modules/collection/ui/office-forms";
it("generic composition offers only unrelated active templates",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement("div");const root=createRoot(host);
  const codes=["vppsone_teacher_task_en_v1","vppsone_teacher_task_hi_v1","vppsone_teacher_task_both_v1","vppsone_teacher_task_reminder_en_v1","vppsone_teacher_task_reminder_hi_v1","vppsone_teacher_task_reminder_both_v1","synthetic_collection_v1"];
  const templates:MessageTemplate[]=codes.map(code=>({id:code,code,labelHi:code,labelEn:code,isActive:true,variables:[],bodyEn:"Synthetic",bodyHi:"Synthetic",hasUrlButton:false,audience:"staff",sortOrder:0}));
  try {
    await act(async()=>root.render(<QueueMessageForm templates={templates}/>));
    expect([...host.querySelectorAll("select[name=templateId] option")].map(o=>(o as HTMLOptionElement).value).filter(Boolean)).toEqual(["synthetic_collection_v1"]);
  }finally{await act(async()=>root.unmount());}
});
