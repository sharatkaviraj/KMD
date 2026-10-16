// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskAcademicForm } from "@/modules/teacher-tasks/ui/task-work";
import type { AcademicWork } from "@/modules/teacher-tasks/data/repo";
import { flushDraftWrites } from "@/platform/drafts/store";
import { m } from "@/messages";

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/modules/collection/ui/request-form", () => ({ RequestForm: () => null }));
vi.mock("@/app/(app)/teach/tasks/actions", () => ({ saveTeacherTaskAction: mocks.save, saveTeacherCollectionAction: vi.fn() }));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const initial = (): AcademicWork => ({ kind: "marks", taskId: id(1), draftScope: "actor-task-token-generation", session: "QA", paperId: id(2), classId: null, day: null, revision: 0, submitted: false, max: 100, step: 1, allowExempt: true, rows: [{ id: id(3), name: "Synthetic child", state: "blank", value: null }] });
let root: Root;
let host: HTMLDivElement;
let work: AcademicWork;
let token: string | undefined;
async function render() { await act(async () => { root.render(<TaskAcademicForm work={work} language="en" token={token} />); }); }
async function reload() { await act(async () => root.unmount()); root = createRoot(host); await render(); }
async function change(selector: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)!;
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(element,value); element.dispatchEvent(new Event("input",{bubbles:true})); element.dispatchEvent(new Event("change",{bubbles:true})); await flushDraftWrites(); });
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => { button!.click(); await flushDraftWrites().catch(() => undefined); });
}
async function submit() { await click(m.taskSubmit.en); await click(m.taskReviewSave.en); }
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); localStorage.clear();
  mocks.save.mockReset(); mocks.refresh.mockReset(); work=initial();token=undefined;
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async () => { await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals(); });

it("recovers offline edits and correction reason after reload without posting", async () => {
  work={...work,submitted:true,revision:2};
  vi.spyOn(navigator,"onLine","get").mockReturnValue(false);
  await render();await change("input[type=number]","42");await change("textarea","Correct the transcribed mark");await reload();
  await click(m.draftRestore.en);
  expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("42");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Correct the transcribed mark");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("restores the exact uncertain command after reload even when the canonical revision advanced", async () => {
  mocks.save.mockRejectedValueOnce(new Error("network response lost")).mockResolvedValueOnce({ok:true,revision:1,replayed:true});
  await render();await change("input[type=number]","24");await submit();
  const first=mocks.save.mock.calls[0];
  work={...work,revision:1,submitted:true};await reload();await click(m.draftRestore.en);
  expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  await click(m.taskRetry.en);
  expect(mocks.save.mock.calls[1]).toEqual(first);
  await reload();expect(host.textContent).not.toContain(m.draftRestore.en);
});
it("keeps an incomplete submission editable and preserves its values", async () => {
  mocks.save.mockResolvedValue({ok:false,reason:"incomplete"});
  await render();await submit();
  expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(false);
  expect(host.textContent).not.toContain(m.taskRetry.en);
  expect(host.textContent).toContain("Before submitting, give every child a mark");
  await change("input[type=number]","17");await reload();await click(m.draftRestore.en);
  expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("17");
});
it.each(["network", "malformed"])("restores and retries the same public-link command after %s response without a signed-in action", async failure => {
  token="synthetic-public-link";
  const fetch=vi.fn();
  if(failure==="network")fetch.mockRejectedValueOnce(new Error("network response lost"));
  else fetch.mockResolvedValueOnce({json:async()=>({error:"edge response lost"})});
  fetch.mockResolvedValueOnce({json:async()=>({ok:true,revision:1})});
  vi.stubGlobal("fetch",fetch);
  await render();await change("input[type=number]","31");await submit();
  const sent=fetch.mock.calls[0];await reload();await click(m.draftRestore.en);await click(m.taskRetry.en);
  expect(fetch.mock.calls[1]).toEqual(sent);expect(mocks.save).not.toHaveBeenCalled();
});
it("recovers attendance status after reload", async () => {
  work={...work,kind:"attendance",paperId:null,classId:id(4),day:"2026-10-16",rows:[{...work.rows[0],state:"present"}]};
  await render();await change("select","leave");await reload();await click(m.draftRestore.en);
  expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("leave");
});
it.each(["other-actor","other-task","rotated-capability"])("does not restore work in the %s scope", async scope => {
  await render();await change("input[type=number]","66");work={...work,draftScope:scope};await render();
  expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(host.textContent).not.toContain(m.draftRestore.en);
});
it("does not send if the exact retry command cannot be stored", async () => {
  await render();await change("input[type=number]","28");
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("full");});
  await submit();expect(mocks.save).not.toHaveBeenCalled();
});
