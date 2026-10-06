// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => {
  const Pending = React.createContext(false);
  return {
    default: ({ children, "data-pending": pending, ...props }: React.ComponentProps<"a"> & { "data-pending"?: boolean }) => (
      <a {...props}><Pending.Provider value={Boolean(pending)}>{children}</Pending.Provider></a>
    ),
    useLinkStatus: () => ({ pending: React.useContext(Pending) }),
  };
});
const route = vi.hoisted(() => ({ pathname: "/teach", search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => route.search,
}));
vi.mock("@/modules/fees/platform/session-context/switching-context", () => ({
  useSessionSwitching: () => ({ isSwitching: false }),
}));

import { NavLink, NAV_EVENT, type NavPendingDetail } from "@/ui/shell/nav-link";
import { RouteProgress } from "@/ui/shell/route-progress";

let root: Root;
let host: HTMLDivElement;
let events: boolean[];
const onNav = (event: Event) => events.push((event as CustomEvent<NavPendingDetail>).detail.pending);
function render(first: boolean, second: boolean | null = null) {
  act(() => root.render(<>
    <RouteProgress />
    <NavLink key="first" href="/students" data-pending={first}>Students</NavLink>
    {second !== null && <NavLink key="second" href="/timetable" data-pending={second}>Timetable</NavLink>}
  </>));
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  route.pathname = "/teach";
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  events = [];
  window.addEventListener(NAV_EVENT, onNav);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(NAV_EVENT, onNav);
  vi.useRealTimers();
});

describe("navigation feedback during real pending changes", () => {
  it("idle links mounting do not announce that another navigation finished", () => {
    render(false);
    expect(events).toEqual([]);
    render(true);
    advance(130);
    render(true, false);
    expect(events).toEqual([true]);
    advance(400);
    expect(host.querySelector(".anim-route-progress")).not.toBeNull();
  });

  it("ending one overlapping navigation keeps feedback for the other", () => {
    render(true, true);
    advance(130);
    render(false, true);
    expect(events.at(-1)).toBe(true);
    advance(400);
    expect(host.querySelector(".anim-route-progress")).not.toBeNull();
    render(false, false);
    expect(events.at(-1)).toBe(false);
    advance(310);
    expect(host.querySelector(".anim-route-progress")).toBeNull();
  });

  it("unmounting the pending link releases the feedback", () => {
    render(true);
    advance(130);
    act(() => root.render(<RouteProgress />));
    expect(events.at(-1)).toBe(false);
    advance(310);
    expect(host.querySelector(".anim-route-progress")).toBeNull();
  });

  it("a URL committing does not hide a second navigation still in flight", () => {
    render(true, true);
    advance(130);
    route.pathname = "/students";
    render(false, true);
    advance(400);
    expect(host.querySelector(".anim-route-progress")).not.toBeNull();
    render(false, false);
    advance(310);
    expect(host.querySelector(".anim-route-progress")).toBeNull();
  });

  it("a new navigation cancels the previous bar's scheduled dismissal", () => {
    render(true);
    advance(130);
    render(false);
    advance(50);
    render(false, true);
    advance(400);
    expect(host.querySelector(".anim-route-progress")).not.toBeNull();
  });

  it("idle pages and instant navigation do not run a hidden infinite animation", () => {
    render(false);
    expect(host.querySelector(".anim-route-progress")).toBeNull();
    render(true);
    advance(50);
    render(false);
    advance(500);
    expect(host.querySelector(".anim-route-progress")).toBeNull();
  });
});
