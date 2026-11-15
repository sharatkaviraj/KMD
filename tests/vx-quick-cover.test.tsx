// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({
  replace: vi.fn(),
  register: vi.fn(),
  cover: vi.fn(),
}));

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, onClick, prefetch, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void; prefetch?: unknown }) => {
    void prefetch;
    return <a href={href} onClick={(e) => { e.preventDefault(); onClick?.(); }} {...rest}>{children}</a>;
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/teach",
  useRouter: () => ({ prefetch: vi.fn(), refresh: vi.fn(), replace: scene.replace, push: vi.fn() }),
}));
vi.mock("@/vx/shell/quick-register", () => ({ quickRegisterAction: scene.register }));
vi.mock("@/lib/ai/ui/lazy-quick-cover", async () => ({
  LazyQuickCover: (props: { tool: unknown }) => {
    scene.cover(props.tool);
    return null;
  },
  LazyQuickCoverRow: (await import("@/lib/ai/ui/quick-cover-row")).QuickCoverRow,
}));
// The bar's lazy sheet is drawn directly in these tests.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { quickFor } from "@/vx/quick";
import { bottomFor } from "@/vx/nav";
import { VxBottomBar } from "@/vx/shell/bottom-bar";
import { QuickSheet } from "@/vx/shell/quick-sheet";
import { closeQuick, openQuick } from "@/vx/shell/quick-state";

let root: Root;
let host: HTMLDivElement;
let layer: HTMLDivElement;

beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  scene.replace.mockReset();
  scene.register.mockReset();
  scene.cover.mockReset();
  layer = document.createElement("div");
  layer.id = "vx-layer";
  document.body.append(layer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => closeQuick());
  act(() => root.unmount());
  host.remove();
  layer.remove();
});

const all = () => true;
const badges = Promise.resolve({ dues: 12, needs: 3 });
const named = (text: string) =>
  Array.from(layer.querySelectorAll<HTMLElement>("button, a")).find((el) => el.textContent?.trim() === text) ?? null;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("the + sheet (D-643)", () => {
  it("shows a class teacher's register on the first card, asked for when the sheet opens", async () => {
    let answer: (v: unknown) => void = () => {};
    scene.register.mockReturnValue(new Promise((r) => { answer = r; }));
    act(() => root.render(<QuickSheet quick={quickFor("teacher", all, { teacherHasClass: true })!} badges={badges} />));
    expect(layer.textContent).toBe("");
    act(() => openQuick());
    expect(layer.textContent).toContain("Mark attendance");
    expect(layer.textContent).toContain("Checking today's register…");
    // The action is fetched with the first register card.
    await settle();
    expect(scene.register).toHaveBeenCalledOnce();
    await act(async () => answer({ state: "open", classes: [{ label: { en: "Class 5", hi: "कक्षा 5" }, saved: false, savedAt: null }] }));
    expect(layer.textContent).toContain("Class 5 · Not marked yet");
    expect(layer.textContent).not.toContain("Checking");
  });

  it("asks again on the next opening rather than showing the old answer", async () => {
    scene.register.mockResolvedValue({ state: "open", classes: [{ label: { en: "Class 5" }, saved: false, savedAt: null }] });
    act(() => root.render(<QuickSheet quick={quickFor("teacher", all, { teacherHasClass: true })!} badges={badges} />));
    act(() => openQuick());
    await settle();
    expect(layer.textContent).toContain("Not marked yet");
    act(() => closeQuick());
    scene.register.mockReturnValue(new Promise(() => {}));
    act(() => openQuick());
    expect(layer.textContent).toContain("Checking today's register…");
    await settle();
    expect(scene.register).toHaveBeenCalledTimes(2);
    expect(layer.textContent).toContain("Checking today's register…");
    expect(layer.textContent).not.toContain("Not marked yet");
  });

  it("opens a tile's page in place of the sheet's own history entry, and says it is opening", () => {
    // A page still on its way: the transition stays pending.
    scene.replace.mockReturnValue(new Promise(() => {}));
    act(() => root.render(<QuickSheet quick={quickFor("admin", all)!} badges={badges} />));
    act(() => openQuick());
    const tile = named("Send a notice")!;
    expect(tile.getAttribute("href")).toBe("/messages?compose=1");
    act(() => tile.click());
    expect(scene.replace).toHaveBeenCalledWith("/messages?compose=1");
    expect(tile.hasAttribute("data-on")).toBe(true);
    expect(layer.textContent).toContain("Opening…");
  });

  it("keeps Last time as it was when the sheet opened, and lights only what was tapped", () => {
    scene.replace.mockReturnValue(new Promise(() => {}));
    window.localStorage.setItem("vx.quick.last", "notice");
    act(() => root.render(<QuickSheet quick={quickFor("admin", all)!} badges={badges} />));
    act(() => openQuick());
    const row = () => layer.querySelector<HTMLElement>(".vx-qs-row:not(.vx-qs-help)");
    expect(row()?.textContent).toContain("Send a notice");

    act(() => named("Collect fee")!.click());
    expect(scene.replace).toHaveBeenCalledWith("/payments");
    // The tap itself is remembered for next time, but the open sheet does not change under the finger.
    expect(window.localStorage.getItem("vx.quick.last")).toBe("collect");
    expect(row()?.textContent).toContain("Send a notice");
    expect(row()?.hasAttribute("data-on")).toBe(false);
    expect(layer.querySelectorAll("[data-on]")).toHaveLength(1);
    window.localStorage.removeItem("vx.quick.last");
  });

  it("opens Last time from its own row, without lighting its tile too", () => {
    scene.replace.mockReturnValue(new Promise(() => {}));
    window.localStorage.setItem("vx.quick.last", "notice");
    act(() => root.render(<QuickSheet quick={quickFor("admin", all)!} badges={badges} />));
    act(() => openQuick());
    const row = layer.querySelector<HTMLElement>(".vx-qs-row:not(.vx-qs-help)")!;
    act(() => row.click());
    expect(scene.replace).toHaveBeenCalledWith("/messages?compose=1");
    expect(row.hasAttribute("data-on")).toBe(true);
    expect(named("Send a notice")?.hasAttribute("data-on")).toBe(false);
    expect(window.localStorage.getItem("vx.quick.last")).toBe("notice");
    window.localStorage.removeItem("vx.quick.last");
  });

  it("shows the counts the shell already reads beside their tiles", async () => {
    act(() => root.render(<QuickSheet quick={quickFor("admin", all)!} badges={badges} />));
    act(() => openQuick());
    await settle();
    expect(layer.querySelector('[aria-label="12 waiting"]')).not.toBeNull();
  });

  it("offers Quick substitute only with built-in AI cover, in place of the plain Substitute tile", () => {
    act(() => root.render(<QuickSheet quick={quickFor("admin", all)!} badges={badges} />));
    act(() => openQuick());
    expect(layer.textContent).toContain("Substitute");
    expect(layer.textContent).not.toContain("Quick substitute");
    act(() => closeQuick());

    act(() => root.render(<QuickSheet quick={quickFor("admin", all, { coverAi: true })!} badges={badges} />));
    act(() => openQuick());
    expect(layer.textContent).toContain("Quick substitute");
    expect(named("Arrange")?.getAttribute("href")).toBe("/substitutions/arrange");
    act(() => named("Arrange")!.click());
    expect(scene.replace).toHaveBeenCalledWith("/substitutions/arrange");
  });

  it("opens the camera on the same tap, and hands the photo over once the sheet has gone", async () => {
    act(() => root.render(<QuickSheet quick={quickFor("admin", all, { coverAi: true })!} badges={badges} />));
    act(() => openQuick());
    const input = layer.querySelector<HTMLInputElement>('input[type="file"][capture="environment"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    act(() => named("Photo")!.click());
    expect(click).toHaveBeenCalledOnce();
    expect(scene.cover).not.toHaveBeenCalled();

    const photo = new File(["register"], "register.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { configurable: true, value: [photo] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
    expect(scene.cover).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "photo", files: [photo] }));
  });
});

describe("the bar's + (D-643)", () => {
  it("turns into Close while its sheet is open, and the bar around it closes the sheet", () => {
    const quick = quickFor("teacher", all, { teacherHasClass: true });
    act(() => root.render(<VxBottomBar tabs={bottomFor("teacher", all)} badges={badges} quick={quick} />));
    const plus = host.querySelector<HTMLButtonElement>("button.vx-center")!;
    expect(plus.getAttribute("aria-label")).toBe("Quick actions");
    expect(plus.getAttribute("aria-expanded")).toBe("false");
    act(() => plus.click());
    const nav = host.querySelector("nav")!;
    expect(plus.getAttribute("aria-expanded")).toBe("true");
    expect(plus.getAttribute("aria-label")).toBe("Close");
    expect(nav.hasAttribute("data-quick")).toBe(true);
    act(() => nav.click());
    expect(plus.getAttribute("aria-expanded")).toBe("false");
    expect(nav.hasAttribute("data-quick")).toBe(false);
  });

  it("leaves the + out of a bar drawn without its list", () => {
    act(() => root.render(<VxBottomBar tabs={bottomFor("teacher", all)} badges={badges} />));
    expect(host.querySelector("button.vx-center")).toBeNull();
    expect(host.querySelectorAll("nav a")).toHaveLength(4);
  });
});
