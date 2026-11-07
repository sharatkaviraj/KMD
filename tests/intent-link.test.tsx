// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/link",()=>({useLinkStatus:()=>({pending:false}),default:({prefetch,children,...props}:React.ComponentProps<"a">&{prefetch:boolean|null})=><a {...props} data-prefetch={String(prefetch)}>{children}</a>}));
import { IntentLink } from "@/vx/ui/intent-link";
let host:HTMLDivElement,root:Root;
beforeEach(async()=>{vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root.render(<IntentLink href="/students/synthetic">Synthetic child</IntentLink>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function event(name:string){await act(async()=>{host.querySelector("a")!.dispatchEvent(new Event(name,{bubbles:true}));});}
async function advance(){await act(async()=>{vi.advanceTimersByTime(100);});}
it("does not prefetch a full profile when a finger is scrolling past its card",async()=>{
  await event("touchstart");expect(host.querySelector("a")!.dataset.prefetch).toBe("false");
  await event("touchmove");await advance();expect(host.querySelector("a")!.dataset.prefetch).toBe("false");
});
it("prefetches a held touch",async()=>{
  await event("touchstart");await advance();expect(host.querySelector("a")!.dataset.prefetch).toBe("true");
});
it("prefetches keyboard focus immediately",async()=>{
  await event("focusin");expect(host.querySelector("a")!.dataset.prefetch).toBe("true");
});
it("cancels a quick touch before navigation and clears timers when unmounted",async()=>{
  await event("touchstart");await event("touchend");await advance();expect(host.querySelector("a")!.dataset.prefetch).toBe("false");
  await event("touchstart");await act(async()=>root.render(null));expect(vi.getTimerCount()).toBe(0);
});
