// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/platform/i18n/use-language", () => ({ useLanguage: () => "en" }));
vi.mock("@/app/(app)/collection/photos/actions", () => ({ placePhotoAction: mocks.save }));
vi.mock("@/app/(app)/collection/photos/profile-actions", () => ({ openPhotoEditorAction: mocks.open, saveProfilePhotoAction: mocks.save }));
import { PhotoTile, FolderPlacement } from "@/modules/collection/ui/photo-forms";
import { ProfilePhotoControl } from "@/modules/collection/ui/profile-photo-editor";
import type { PhotoCredential } from "@/modules/collection/domain/profile-photo";
import { flushDraftWrites } from "@/platform/drafts/store";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 60, height: 80, close() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {}, fillRect() {} } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(cb => cb(new Blob(["synthetic-photo"], { type: "image/jpeg" })));
  mocks.save.mockReset().mockResolvedValue({ ok: true, message: { en: "Saved", hi: "Saved" } });
  mocks.open.mockReset().mockResolvedValue({ ok: true, credential: { kind: "student", id: "child" }, context: { scope: "synthetic-actor-student", studentId: "child", currentId: null, currentUrl: null, proposalId: null, proposalUrl: null, proposal: false, decided: false } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<PhotoTile child={{ studentId: "child", name: "Synthetic child", srNo: "TEST", externalId: null, photoId: null, photoUrl: null }} />)); }
async function choose() {
  const open = [...host.querySelectorAll("button")].find(b => b.textContent === "Change photograph");
  if (open) await act(async () => open.click());
  const input = host.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic"], "photo.jpg", { type: "image/jpeg" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(r => setTimeout(r, 30)); });
}
it("choosing and cancelling a preview never uploads or changes the official photograph", async () => {
  await render(); await choose();
  expect(mocks.save).not.toHaveBeenCalled();
  const cancel = [...host.querySelectorAll("button")].find(b => b.textContent === "Cancel"); expect(cancel).toBeDefined();
  await act(async () => cancel!.click()); expect(mocks.save).not.toHaveBeenCalled(); expect(host.querySelector('[data-photo-preview]')).toBeNull();
});
it("only explicit Save sends the chosen photograph once", async () => {
  await render(); await choose(); expect(mocks.save).not.toHaveBeenCalled();
  const save = [...host.querySelectorAll("button")].find(b => b.textContent === "Save photograph"); expect(save).toBeDefined();
  await act(async () => save!.click()); expect(mocks.save).toHaveBeenCalledTimes(1);
});
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === label); expect(button,label).toBeDefined();
  await act(async () => { button!.click(); await flushDraftWrites().catch(() => undefined); });
}
it("restores a lost-response command after reload and retries exactly once with the same bytes and identity", async () => {
  mocks.save.mockResolvedValue({ok:false,reason:"unknown"});
  await render(); await choose(); await click("Save photograph");
  const sent = mocks.save.mock.calls[0][1] as FormData;
  expect([...host.querySelectorAll("button")].find(b=>b.textContent==="Cancel")?.disabled).toBe(true);
  await act(async()=>root.unmount()); root=createRoot(host); await render(); await click("Change photograph"); await click("Bring back the photo kept on this phone");
  mocks.save.mockResolvedValue({ok:true}); await click("Retry this photograph");
  const retry=mocks.save.mock.calls[1][1] as FormData;
  expect(retry.get("commandId")).toBe(sent.get("commandId")); expect((retry.get("photo") as File).size).toBe((sent.get("photo") as File).size);
  expect(mocks.save).toHaveBeenCalledTimes(2);
});
it("keeps the preview editable after a definite stale refusal", async () => {
  mocks.save.mockResolvedValue({ok:false,reason:"stale"}); await render(); await choose(); await click("Save photograph");
  expect(host.querySelector('[data-photo-preview]')).not.toBeNull();
  expect([...host.querySelectorAll("button")].find(b=>b.textContent==="Save photograph")?.disabled).toBe(false);
  await click("Cancel"); expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("does not send when durable command persistence fails", async () => {
  await render(); await choose(); vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("full")});
  await click("Save photograph"); expect(mocks.save).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Nothing was sent");
});
it("does not restore a previous actor or capability generation's photo", async () => {
  mocks.save.mockResolvedValue({ok:false,reason:"unknown"}); await render(); await choose(); await click("Save photograph");
  await act(async()=>root.unmount()); root=createRoot(host);
  const previous=await mocks.open(); mocks.open.mockResolvedValue({...previous,context:{...previous.context,scope:"different-actor-or-token"}});
  await render(); await click("Change photograph");
  expect(host.textContent).not.toContain("Bring back the photo kept on this phone"); expect(host.querySelector('[data-photo-preview]')).toBeNull();
});
it("refuses a JPEG that remains above the cap at the lowest quality", async () => {
  vi.spyOn(HTMLCanvasElement.prototype,"toBlob").mockImplementation(cb=>cb(new Blob([new Uint8Array(204801)],{type:"image/jpeg"})));
  await render(); await choose(); expect(mocks.save).not.toHaveBeenCalled(); expect(host.textContent).toContain("200 KB"); expect(host.querySelector('[data-photo-preview]')).toBeNull();
});
it("retains a folder placement's uncertain command and bytes across reload", async () => {
  const roster=[{studentId:"child",name:"Synthetic child",srNo:"TEST123",externalId:null,photoId:null,photoUrl:null}];
  const folder=()=>root.render(<FolderPlacement roster={roster} recoveryScope="synthetic-owner-session-class"/>);
  mocks.save.mockResolvedValue({ok:false,reason:"unknown",message:{en:"Unknown",hi:"Unknown"}});
  await act(async()=>folder());
  const input=host.querySelector<HTMLInputElement>('input[name=folder]')!;
  Object.defineProperty(input,"files",{value:[new File(["synthetic"],"TEST123.jpg",{type:"image/jpeg"})]});
  await act(async()=>{input.dispatchEvent(new Event("change",{bubbles:true}));await new Promise(r=>setTimeout(r,30));});
  const place=[...host.querySelectorAll("button")].find(b=>b.textContent?.includes("(1)"))!;
  await act(async()=>place.click());
  expect(mocks.save).toHaveBeenCalledTimes(1); const first=mocks.save.mock.calls[0][0] as FormData;
  await act(async()=>root.unmount());root=createRoot(host);await act(async()=>folder());
  await click("Bring back the photo kept on this phone");
  mocks.save.mockResolvedValue({ok:true,message:{en:"Saved",hi:"Saved"}});
  const retry=[...host.querySelectorAll("button")].find(b=>b.textContent?.includes("(1)"))!;
  await act(async()=>retry.click()); const second=mocks.save.mock.calls[1][0] as FormData;
  expect(second.get("commandId")).toBe(first.get("commandId"));expect((second.get("photo") as File).size).toBe((first.get("photo") as File).size);
});

function staffContext(id: string) {
  return {ok:true as const,credential:{kind:"staff" as const,id},context:{scope:`synthetic-staff-${id}`,currentId:null,currentUrl:null,proposalId:null,proposalUrl:null,proposal:false,decided:false}};
}
async function staffControl(id: string) {
  await act(async()=>root.render(<ProfilePhotoControl credential={{kind:"staff",id}} language="en"/>));
}
it("switching selected staff resets the open editor and saves only to the newly selected person",async()=>{
  mocks.open.mockImplementation(async(credential:PhotoCredential)=>staffContext("id" in credential?credential.id!:"self"));
  await staffControl("staff-a");await choose();
  await staffControl("staff-b");
  expect(host.querySelector('[data-photo-preview]')).toBeNull();
  await choose();await click("Save photograph");
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0]).toEqual({kind:"staff",id:"staff-b"});
});
it("ignores a late open response from the previously selected staff member",async()=>{
  let finishA!: (value:ReturnType<typeof staffContext>)=>void;
  mocks.open.mockImplementation((credential:PhotoCredential)=>"id" in credential && credential.id==="staff-a"?new Promise(resolve=>{finishA=resolve;}):Promise.resolve(staffContext("staff-b")));
  await staffControl("staff-a");await click("Change photograph");
  await staffControl("staff-b");await click("Change photograph");
  await act(async()=>finishA(staffContext("staff-a")));
  await choose();await click("Save photograph");
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0]).toEqual({kind:"staff",id:"staff-b"});
});
it("reconciles the exact uncertain command after the proposal was reviewed, without enabling new edits",async()=>{
  mocks.save.mockResolvedValue({ok:false,reason:"unknown"});await render();await choose();await click("Save photograph");
  const sent=mocks.save.mock.calls[0][1] as FormData;
  await act(async()=>root.unmount());root=createRoot(host);
  const previous=await mocks.open();
  mocks.open.mockResolvedValue({...previous,context:{...previous.context,proposal:true,decided:true,proposalId:sent.get("commandId")}});
  await render();await click("Change photograph");await click("Bring back the photo kept on this phone");
  expect(host.querySelector<HTMLInputElement>('input[type=file]')?.disabled).toBe(true);
  expect([...host.querySelectorAll("button")].find(b=>b.textContent==="Cancel")?.disabled).toBe(true);
  expect([...host.querySelectorAll("button")].find(b=>b.textContent==="Retry this photograph")?.disabled).toBe(false);
  mocks.save.mockResolvedValue({ok:true});await click("Retry this photograph");
  const retried=mocks.save.mock.calls[1][1] as FormData;
  for(const field of ["commandId","scope","studentId","source","expectedCurrent","expectedProposal"]) expect(retried.get(field)).toBe(sent.get(field));
  const read=(file:Blob)=>new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(file);});
  expect(await read(retried.get("photo") as Blob)).toBe(await read(sent.get("photo") as Blob));
  expect(host.querySelector('[data-photo-editor]')).toBeNull();
});
it("keeps unsent drafts and file inputs blocked on a reviewed round while allowing cancellation",async()=>{
  await render();await choose();await act(async()=>root.unmount());root=createRoot(host);
  const previous=await mocks.open();mocks.open.mockResolvedValue({...previous,context:{...previous.context,proposal:true,decided:true}});
  await render();await click("Change photograph");await click("Bring back the photo kept on this phone");
  expect([...host.querySelectorAll("button")].find(b=>b.textContent==="Save photograph")?.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[type=file]')?.disabled).toBe(true);
  await click("Cancel");expect(mocks.save).not.toHaveBeenCalled();
});
