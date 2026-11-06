// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/link",()=>({default:React.forwardRef<HTMLAnchorElement,React.ComponentProps<"a">&{prefetch?:boolean|null}>(function MockLink({prefetch,children,...props},ref){return <a ref={ref} {...props} data-prefetch={String(prefetch)}>{children}</a>;})}));
import Link from "@/vx/ui/link";

/* D-439: a screen link fetches nothing until someone means to open it. Calendar used to prefetch 53 pages on open. */
let host:HTMLDivElement,root:Root;
async function mount(node:React.ReactNode){await act(async()=>root.render(node));}
async function event(name:string){await act(async()=>{host.querySelector("a")!.dispatchEvent(new Event(name,{bubbles:true}));});}
async function advance(){await act(async()=>{vi.advanceTimersByTime(100);});}
const prefetch=()=>host.querySelector("a")!.dataset.prefetch;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});

describe("vx Link", () => {
  it("does not prefetch just for being on screen", async () => {
    await mount(<Link href="/calendar?day=2026-11-06">6</Link>);
    expect(prefetch()).toBe("false");
  });
  it("prefetches the whole page once a finger rests on it, not when it scrolls past", async () => {
    await mount(<Link href="/students/synthetic">Child</Link>);
    await event("touchstart"); await event("touchmove"); await advance();
    expect(prefetch()).toBe("false");
    await event("touchstart"); await advance();
    expect(prefetch()).toBe("true");
  });
  it("prefetches on keyboard focus", async () => {
    await mount(<Link href="/notes">Notes</Link>);
    await event("focusin");
    expect(prefetch()).toBe("true");
  });
  it("keeps an explicit prefetch choice", async () => {
    await mount(<Link href="/fees/receipts/x/pdf" prefetch={false}>PDF</Link>);
    await event("focusin");
    expect(prefetch()).toBe("false");
  });
});

describe("vx screens use the intent link", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
  it("no screen imports next/link directly", () => {
    const offenders = walk(join(process.cwd(), "src/vx/screens")).filter((file) => /from\s+["']next\/link["']/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
