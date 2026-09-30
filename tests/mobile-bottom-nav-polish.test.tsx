// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../src/messages/en.json";

const route = vi.hoisted(() => ({ pathname: "/dashboard", query: "session=2026-27" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.query),
}));
vi.mock("next-intl", () => ({ useTranslations: (namespace: keyof typeof messages) => {
  const catalogue = messages[namespace] as Record<string, string>;
  const t = (key: string) => catalogue[key] ?? key;
  t.has = (key: string) => key in catalogue;
  return t;
} }));
vi.mock("../src/ui/shell/nav-link", () => ({
  NAV_EVENT: "test-navigation",
  NavLink: ({ children, unstable_dynamicOnHover, ...props }: React.ComponentProps<"a"> & { unstable_dynamicOnHover?: boolean }) => {
    void unstable_dynamicOnHover;
    return <a {...props} onClick={event => { event.preventDefault(); props.onClick?.(event); }}>{children}</a>;
  },
}));
vi.mock("../src/ui/primitives/sheet", () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
import { MobileBottomNav } from "../src/ui/shell/mobile-bottom-nav";

let root: Root;
let host: HTMLDivElement;
let notifyResize: () => void;
let visible: boolean;
let height: number;
const disconnect = vi.fn();
const items = [
  { href: "/dashboard", label: "Home" },
  { href: "/students", label: "विद्यार्थियों की सूची Students" },
  { href: "/fees/payments", label: "Collect" },
  { href: "/timetable", label: "Timetable" },
];
function render() {
  act(() => root.render(<MobileBottomNav staffRole="admin" items={items} counts={{ "/fees/payments": 121 }} moreGroups={[]} />));
}
function tab(href: string) { return host.querySelector<HTMLAnchorElement>(`nav a[href^="${href}"]`)!; }

beforeEach(() => {
  route.pathname = "/dashboard";
  visible = true;
  height = 123.5;
  disconnect.mockClear();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() => (visible ? [{}] : []) as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height } as DOMRect));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.style.removeProperty("--mobile-bottom-nav-offset");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("bottom tab polish preserves navigation context", () => {
  it("uses identical full-width targets and equal icon frames while allowing complete labels", () => {
    render();
    const tabs = Array.from(host.querySelectorAll<HTMLElement>("nav > div > a, nav > div > button"));
    expect(tabs).toHaveLength(5);
    expect(new Set(tabs.map(element => element.className)).size).toBe(1);
    for (const element of tabs) {
      expect(element.className).toContain("w-full");
      expect(element.className).toContain("items-center");
      expect(element.className).toContain("motion-reduce:transition-none");
      const icon = element.firstElementChild!;
      expect(icon.className).toContain("w-10");
      expect(icon.className).not.toContain("transition-all");
      const label = element.lastElementChild!;
      expect(label.className).toContain("text-center");
      expect(label.className).toContain("whitespace-normal");
      expect(label.className).not.toContain("truncate");
    }
    expect(tab("/students").textContent).toContain("विद्यार्थियों की सूची Students");
    expect(tab("/fees/payments").href).toContain("session=2026-27");
    expect(tab("/fees/payments").textContent).toContain("99+");
  });

  it("paints the pending destination without changing the committed aria-current and clears a cancelled navigation", () => {
    render();
    act(() => tab("/students").click());
    expect(tab("/dashboard").getAttribute("aria-current")).toBe("page");
    expect(tab("/students").getAttribute("aria-current")).toBeNull();
    expect(tab("/students").firstElementChild!.className).toContain("bg-accent/10");
    act(() => window.dispatchEvent(new CustomEvent("test-navigation", { detail: { pending: false } })));
    expect(tab("/students").firstElementChild!.className).not.toContain("bg-accent/10");
    expect(tab("/dashboard").firstElementChild!.className).toContain("bg-accent/10");
  });

  it("does not paint a modified click as pending", () => {
    render();
    act(() => tab("/students").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true })));
    expect(tab("/dashboard").firstElementChild!.className).toContain("bg-accent/10");
    expect(tab("/students").firstElementChild!.className).not.toContain("bg-accent/10");
  });

  it("tracks actual border-box clearance and restores prior inline value and priority on tablet or unmount", () => {
    document.documentElement.style.setProperty("--mobile-bottom-nav-offset", "77px", "important");
    render();
    expect(document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset")).toBe("124px");
    height = 190;
    act(() => notifyResize());
    expect(document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset")).toBe("190px");
    visible = false;
    act(() => notifyResize());
    expect(document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset")).toBe("77px");
    expect(document.documentElement.style.getPropertyPriority("--mobile-bottom-nav-offset")).toBe("important");
    visible = true;
    act(() => notifyResize());
    expect(document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset")).toBe("190px");
    act(() => root.render(null));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset")).toBe("77px");
    expect(document.documentElement.style.getPropertyPriority("--mobile-bottom-nav-offset")).toBe("important");
  });

  it("cleans up measured clearance when a takeover replaces the tabs", () => {
    render();
    route.pathname = "/fees/students/synthetic-id";
    render();
    expect(host.querySelector("nav")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset")).toBe("");
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
