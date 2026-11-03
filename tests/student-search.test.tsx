// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({replace:vi.fn(),rows:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:state.replace})}));
import { StudentSearchProvider, StudentSearchForm, StudentSearchInput } from "@/vx/screens/admin/student-search";

let host:HTMLDivElement,root:Root;
const href="/students?class=qa&view=fees&seg=pending,bus&look=class&status=all&missing=photo&sort=class";
function Rows(){state.rows();return <div>{Array.from({length:50},(_,i)=><article key={i}>Synthetic child {i}</article>)}</div>;}
async function render(query="",base=href){await act(async()=>root.render(<StudentSearchProvider query={query} href={base}>
  <StudentSearchForm><StudentSearchInput id="phone" aria-label="Phone search" /></StudentSearchForm>
  <StudentSearchForm><StudentSearchInput id="desktop" aria-label="Desktop search" /></StudentSearchForm>
  <Rows />
</StudentSearchProvider>));}
async function type(value:string,id="phone"){
  const input=host.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
}
async function advance(ms:number){await act(async()=>{vi.advanceTimersByTime(ms);});}
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});

it("keeps both inputs in sync without rerendering the student cards and searches once after 250 ms",async()=>{
  await render();const renders=state.rows.mock.calls.length;
  await type("A");await advance(100);await type("Aar");
  expect(host.querySelector<HTMLInputElement>("#desktop")!.value).toBe("Aar");
  expect(state.rows).toHaveBeenCalledTimes(renders);
  await advance(249);expect(state.replace).not.toHaveBeenCalled();
  await advance(1);expect(state.replace).toHaveBeenCalledOnce();
  const [next,options]=state.replace.mock.calls[0];const params=new URL(next,"https://one.invalid").searchParams;
  expect(params.get("q")).toBe("Aar");
  for(const [key,value] of new URL(href,"https://one.invalid").searchParams)expect(params.get(key)).toBe(value);
  expect(options).toEqual({scroll:false});
});
it("submits Enter immediately and cancels its debounce",async()=>{
  await render();await type("  Aarav  ");
  await act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
  expect(state.replace).toHaveBeenCalledOnce();expect(state.replace.mock.calls[0][0]).toContain("q=Aarav");
  await advance(1000);expect(state.replace).toHaveBeenCalledOnce();
});
it("clears a search without losing the current filters",async()=>{
  await render("Aarav");await type("");await advance(250);
  expect(state.replace).toHaveBeenCalledOnce();const url=new URL(state.replace.mock.calls[0][0],"https://one.invalid");
  expect(url.searchParams.has("q")).toBe(false);expect(url.searchParams.get("missing")).toBe("photo");
});
it("cancels an old query when a different filter arrives and adopts the server query",async()=>{
  await render();await type("obsolete");
  await render("server query",`${href}&page=2`);await advance(1000);
  expect(state.replace).not.toHaveBeenCalled();expect(host.querySelector<HTMLInputElement>("#phone")!.value).toBe("server query");
  await type("current");await advance(250);expect(state.replace.mock.calls[0][0]).toContain("q=current");
});
it("keeps newer typing when an earlier search result arrives",async()=>{
  await render();await type("A");await advance(250);
  await type("Aarav");await render("A");
  expect(host.querySelector<HTMLInputElement>("#phone")!.value).toBe("Aarav");
  await advance(250);expect(state.replace).toHaveBeenCalledTimes(2);
  expect(new URL(state.replace.mock.calls[1][0],"https://one.invalid").searchParams.get("q")).toBe("Aarav");
});
it("cancels an in-flight search when the user returns to the original query",async()=>{
  await render();await type("A");await advance(250);await type("");await advance(250);
  expect(state.replace).toHaveBeenCalledTimes(2);
  expect(new URL(state.replace.mock.calls[1][0],"https://one.invalid").searchParams.has("q")).toBe(false);
  await render("A");await render("");expect(host.querySelector<HTMLInputElement>("#phone")!.value).toBe("");
});
it("recognizes the server's normalized query without dropping newer typing",async()=>{
  await render();await type("A  B");await advance(250);await type("A  Ba");await render("A B");
  expect(host.querySelector<HTMLInputElement>("#phone")!.value).toBe("A  Ba");
  await advance(250);expect(state.replace).toHaveBeenCalledTimes(2);
  expect(new URL(state.replace.mock.calls[1][0],"https://one.invalid").searchParams.get("q")).toBe("A Ba");
});
it("adopts an external query and cancels typing even when its other filters are unchanged",async()=>{
  await render();await type("obsolete");await render("external");await advance(1000);
  expect(state.replace).not.toHaveBeenCalled();expect(host.querySelector<HTMLInputElement>("#phone")!.value).toBe("external");
});
it("does not navigate for partial IME composition and searches the committed text",async()=>{
  await render();const input=host.querySelector<HTMLInputElement>("#phone")!;
  await act(async()=>{input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));});
  await type("आ");await advance(1000);expect(state.replace).not.toHaveBeenCalled();
  await type("आरव");await act(async()=>{input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"आरव"}));});
  await advance(250);expect(new URL(state.replace.mock.calls[0][0],"https://one.invalid").searchParams.get("q")).toBe("आरव");
});
it("cancels pending navigation when the list unmounts",async()=>{
  await render();await type("obsolete");await act(async()=>root.render(null));await advance(1000);expect(state.replace).not.toHaveBeenCalled();
});
