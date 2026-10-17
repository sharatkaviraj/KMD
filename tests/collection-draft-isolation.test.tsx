// @vitest-environment jsdom
import * as React from "react";
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
vi.mock("@/app/r/[token]/actions",()=>({submitAnswersAction:vi.fn()}));
vi.mock("@/modules/collection/ui/profile-photo-editor",()=>({ProfilePhotoControl:()=>null}));
import {RequestForm} from "@/modules/collection/ui/request-form";
import {flushDraftWrites} from "@/platform/drafts/store";
import type {CollectionField} from "@/modules/collection/domain/fields";
it("remounts scalar editor state and recovery when server scope changes without a page reload",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});localStorage.clear();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const field={id:"field",key:"note",labelEn:"Note",labelHi:"Note",inputType:"text",mode:"confirm",exactLen:null,pattern:null,maxValue:null,options:null} as CollectionField;
  const roll=[{studentId:"child",fullName:"Synthetic",fatherName:null,rollNo:"1",current:{},answered:{}}];
  const render=async(scope:string)=>act(async()=>{root.render(<RequestForm token="" draftScope={scope} sessionLabel="QA" fields={[field]} roll={roll} language="en"/>);});
  try {
    await render("first-actor-and-generation");
    const input=host.querySelector<HTMLInputElement>('input:not([type="hidden"])')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"private draft");input.dispatchEvent(new Event("input",{bubbles:true}));await flushDraftWrites();});
    expect(input.value).toBe("private draft");
    for(const scope of ["replacement-actor","rotated-public-token","login-versus-public","changed-fields","changed-roster"]){
      await render(scope);expect(host.querySelector<HTMLInputElement>('input:not([type="hidden"])')!.value).toBe("");expect(host.textContent).not.toContain("Restore and review");
    }
  } finally {await act(async()=>root.unmount());host.remove();}
});
