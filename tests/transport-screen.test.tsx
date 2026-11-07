// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Transport screen (D-550) on made-up routes, children and drivers: the
 * route cards, a route's sheet, the bus times, and the Add a bus form, which
 * marks what is missing before anything is sent and sends one draft after.
 */

const state = vi.hoisted(() => ({ saveTrip: vi.fn(), saveDriver: vi.fn(), toast: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/ui/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/ui/feedback/cue", () => ({ cue: vi.fn() }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/ui/overlays", () => ({
  useToast: () => ({ show: state.toast }),
  Sheet: ({ open, title, children, footer }: { open: boolean; title?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <section data-sheet><h2>{title}</h2>{children}{footer}</section> : null,
}));
vi.mock("@/vx/ui/page", () => ({
  VxPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  TopBar: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Section: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Grid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Banner: ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => <div role="note">{children}{action}</div>,
}));
vi.mock("@/vx/ui/voice", () => ({
  VoiceNote: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <textarea value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("@/app/(app)/transport/actions", () => ({
  saveTripAction: state.saveTrip,
  saveDriverAction: state.saveDriver,
  deleteTripAction: vi.fn(),
  deleteDriverAction: vi.fn(),
  refreshRouteNamesAction: vi.fn(),
}));

import type { Driver, Rider, RouteInfo, Trip } from "@/modules/transport/domain/board";
import { TransportScreen } from "@/vx/screens/transport/transport-screen";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROUTE = { a: u(1), b: u(2), none: u(3) };
const routes: RouteInfo[] = [
  { id: ROUTE.a, name: "Route Alpha", code: null, isActive: true, placeholder: false },
  { id: ROUTE.b, name: "Route Beta", code: null, isActive: true, placeholder: false },
  { id: ROUTE.none, name: "No Transport", code: null, isActive: true, placeholder: true },
];
const kid = (n: number, routeId: string, name: string): Rider => ({ id: u(100 + n), name, admissionNo: `T-${n}`, classId: u(200), classLabel: "Class 3", classOrder: 3, routeId, photo: null });
const riders = [kid(1, ROUTE.a, "Test Child One"), kid(2, ROUTE.a, "Test Child Two"), kid(3, ROUTE.b, "Test Child Three"), kid(4, ROUTE.none, "Test Child Walks")];
const drivers: Driver[] = [{ id: u(301), name: "Driver Test", phone: "9000000001", notes: null, updatedAt: "2026-11-07T10:00:00Z" }];
const trips: Trip[] = [{
  id: u(401), shift: "morning", startsAt: "07:05", busName: "Bus 1", vehicleNo: null, driverId: u(301), helperName: null, helperPhone: null, notes: null,
  stops: [{ routeId: ROUTE.a, stopTime: "07:20" }], updatedAt: "2026-11-07T10:00:00Z",
}];

let root: Root;
let host: HTMLDivElement;

async function render(props: Partial<React.ComponentProps<typeof TransportScreen>> = {}) {
  await act(async () =>
    root.render(
      <TransportScreen
        sessionLabel="TEST-2026-27"
        test
        canManage
        canRefreshNames={false}
        canOpenChildren
        fleetReady
        routeSource="local"
        routes={routes}
        riders={riders}
        drivers={drivers}
        trips={trips}
        initialTab="routes"
        {...props}
      />,
    ),
  );
}

const buttons = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent?.includes(text));
const click = async (el: Element) => act(async () => { (el as HTMLElement).click(); });
async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const sheet = () => host.querySelector("section[data-sheet]");

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Transport screen", () => {
  it("shows every route with its children and buses, never the No Transport row", async () => {
    await render();
    const text = host.textContent ?? "";
    expect(text).toContain("Route Alpha");
    expect(text).toContain("Route Beta");
    expect(text).not.toContain("No Transport");
    expect(text).toContain("Children on buses");
    expect(text).toContain("With children on them");
    // Each class with its count in brackets: spaces between them collapsed into "Class 3 · 2 Class 5 · 1".
    expect(text).toContain("Class 3 (2)");
    // Route Beta has children and no bus yet: it says so.
    expect(text).toContain("No morning bus yet");
  });

  it("opens a route: its bus, a Call button for the driver, and its children", async () => {
    await render();
    await click(buttons("Route Alpha")[0]);
    const open = sheet()!;
    expect(open.querySelector("h2")?.textContent).toBe("Route Alpha");
    expect(open.textContent).toContain("Bus 1");
    expect(open.textContent).toContain("Driver: Driver Test");
    expect(open.querySelector('a[href="tel:+919000000001"]')).not.toBeNull();
    expect(open.textContent).toContain("Test Child One");
    expect(open.querySelector(`a[href="/students/${u(101)}"]`)).not.toBeNull();
  });

  it("lists the bus runs with their driver and routes in order", async () => {
    await render({ initialTab: "times" });
    const text = host.textContent ?? "";
    expect(text).toContain("Bus 1");
    expect(text).toContain("Driver Test");
    expect(text).toContain("Carries 2 children");
  });

  it("marks what is missing before it sends a new bus, then sends one draft", async () => {
    state.saveTrip.mockResolvedValue({ ok: true, message: { en: "Bus saved" }, id: u(402) });
    await render();
    await click(buttons("Add a bus")[0]);
    expect(sheet()?.querySelector("h2")?.textContent).toBe("Add a bus");

    await click(buttons("Save bus")[0]);
    expect(state.saveTrip).not.toHaveBeenCalled();
    expect(sheet()?.textContent).toContain("Please fix the boxes marked in red.");
    expect(sheet()?.textContent).toContain("Add at least one route.");

    await type(sheet()!.querySelector<HTMLInputElement>('input[type="time"]')!, "07:40");
    const name = [...sheet()!.querySelectorAll<HTMLInputElement>("input")].find((i) => i.placeholder === "Bus 1")!;
    await type(name, "Bus 2");
    // The route list is open for a new bus: tap Route Beta to add it.
    await click([...sheet()!.querySelectorAll("button")].find((b) => b.textContent?.includes("Route Beta"))!);
    expect(sheet()?.textContent).toContain("This bus carries 1 child");

    await click(buttons("Save bus")[0]);
    expect(state.saveTrip).toHaveBeenCalledTimes(1);
    const sent = state.saveTrip.mock.calls[0][0];
    expect(sent.session).toBe("TEST-2026-27");
    expect(sent.expected).toBeNull();
    expect(sent.draft).toMatchObject({ id: null, startsAt: "07:40", busName: "Bus 2", stops: [{ routeId: ROUTE.b, stopTime: "" }] });
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ text: "Bus saved", tone: "ok" }));
  });

  it("shows no change buttons to a reader without transport:manage", async () => {
    await render({ canManage: false });
    expect(buttons("Add a bus")).toHaveLength(0);
    expect(host.textContent).toContain("Ask the office or an administrator to change them.");
  });
});
