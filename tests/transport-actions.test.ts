import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Transport's server actions (D-550): who may change buses, and what one Save
 * may write. Every library below is a mock; nothing reaches a database.
 */

const m = vi.hoisted(() => ({
  permission: vi.fn(),
  preview: vi.fn(),
  session: vi.fn(),
  writable: vi.fn(),
  canonical: vi.fn(),
  fleet: vi.fn(),
  routes: vi.fn(),
  refresh: vi.fn(),
  saveDriver: vi.fn(),
  saveTrip: vi.fn(),
  removeDriver: vi.fn(),
  removeTrip: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: m.session }));
vi.mock("@/modules/transport/data/fleet", () => ({ readFleet: m.fleet }));
vi.mock("@/modules/transport/data/routes", () => ({ readRoutes: m.routes, refreshRouteCopy: m.refresh }));
vi.mock("@/modules/transport/data/writes", () => ({ saveDriver: m.saveDriver, saveTrip: m.saveTrip, removeDriver: m.removeDriver, removeTrip: m.removeTrip }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: m.permission }));
vi.mock("@/platform/auth/test-session-access", () => ({ assertSessionWritable: m.writable }));
vi.mock("@/platform/fees-bridge/policy", () => ({ usesCanonicalFees: m.canonical }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: m.preview }));

import { deleteTripAction, refreshRouteNamesAction, saveDriverAction, saveTripAction } from "@/app/(app)/transport/actions";
import { emptyTrip, type TripDraft } from "@/modules/transport/domain/board";
import { W } from "@/vx/screens/transport/words";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSION = "TEST-2026-27";
const ROUTE = { a: u(1), b: u(2), gone: u(3) };
const staff = { id: u(900), role: "office" };

const bus = (patch: Partial<TripDraft> = {}): TripDraft => ({ ...emptyTrip("morning", [ROUTE.a]), startsAt: "07:05", busName: "Bus 1", ...patch });

beforeEach(() => {
  vi.clearAllMocks();
  m.permission.mockResolvedValue(staff);
  m.preview.mockResolvedValue(undefined);
  m.session.mockResolvedValue(SESSION);
  m.writable.mockResolvedValue(undefined);
  m.canonical.mockReturnValue(false);
  m.fleet.mockResolvedValue({
    ready: true,
    drivers: [{ id: u(301), name: "Driver One", phone: null, notes: null, updatedAt: "2026-11-07T10:00:00Z" }],
    trips: [{ id: u(401), shift: "morning", startsAt: "07:05", busName: "Bus 1", vehicleNo: null, driverId: null, helperName: null, helperPhone: null, notes: null, stops: [{ routeId: ROUTE.gone, stopTime: null }], updatedAt: "2026-11-07T10:00:00Z" }],
  });
  m.routes.mockResolvedValue({
    routes: [
      { id: ROUTE.a, name: "Route Alpha", code: null, isActive: true, placeholder: false },
      { id: ROUTE.b, name: "No Transport", code: null, isActive: true, placeholder: true },
    ],
    source: "local",
    refreshedAt: null,
  });
  m.saveDriver.mockResolvedValue({ ok: true, value: { id: u(302) } });
  m.saveTrip.mockResolvedValue({ ok: true, value: { id: u(402), updatedAt: "2026-11-07T10:05:00Z" } });
  m.removeTrip.mockResolvedValue({ ok: true, value: null });
});

const writes = () => m.saveDriver.mock.calls.length + m.saveTrip.mock.calls.length + m.removeTrip.mock.calls.length;

describe("who may change buses", () => {
  it("needs transport:manage", async () => {
    m.permission.mockRejectedValue(new Error("forbidden"));
    expect(await saveDriverAction({ session: SESSION, draft: { id: null, name: "Driver Two", phone: "", notes: "" } })).toEqual({ ok: false, message: W.answer.denied });
    expect(m.permission).toHaveBeenCalledWith("transport:manage");
    expect(writes()).toBe(0);
  });

  it("refuses while the app is seen as another role", async () => {
    m.preview.mockRejectedValue(new Error("previewing"));
    expect(await deleteTripAction({ session: SESSION, id: u(401) })).toEqual({ ok: false, message: W.answer.preview });
    expect(writes()).toBe(0);
  });

  it("refuses when the year shown is not the account's year now, or one it may not write", async () => {
    m.session.mockResolvedValue("2026-27");
    expect((await saveTripAction({ session: SESSION, draft: bus(), expected: null })).message).toEqual(W.answer.session);
    m.session.mockResolvedValue(SESSION);
    m.writable.mockRejectedValue(new Error("read_only"));
    expect((await saveTripAction({ session: SESSION, draft: bus(), expected: null })).message).toEqual(W.answer.session);
    expect((await saveTripAction({ session: "anything", draft: bus(), expected: null })).message).toEqual(W.answer.bad_request);
    expect(writes()).toBe(0);
  });
});

describe("saving a bus", () => {
  it("saves a good bus for the session it was shown in", async () => {
    const result = await saveTripAction({ session: SESSION, draft: bus({ driverId: u(301) }), expected: null });
    expect(result).toMatchObject({ ok: true, id: u(402) });
    expect(m.saveTrip).toHaveBeenCalledWith(SESSION, staff.id, expect.objectContaining({ busName: "Bus 1", driverId: u(301), stops: [{ routeId: ROUTE.a, stopTime: null }] }), null);
    expect(m.revalidate).toHaveBeenCalledWith("/transport");
  });

  it("checks the whole bus before it adds a new driver, so a refused bus leaves no driver behind", async () => {
    const result = await saveTripAction({ session: SESSION, draft: bus({ busName: "", driverId: "new" }), expected: null, newDriver: { id: null, name: "", phone: "123", notes: "" } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual({ busName: "required", "newDriver.name": "required", "newDriver.phone": "phone" });
    expect(writes()).toBe(0);
  });

  it("adds a new driver and gives them the bus in one Save", async () => {
    const result = await saveTripAction({ session: SESSION, draft: bus({ driverId: "new" }), expected: null, newDriver: { id: null, name: "Driver Two", phone: "90000 00004", notes: "" } });
    expect(result.ok).toBe(true);
    expect(m.saveDriver).toHaveBeenCalledWith(SESSION, staff.id, null, { name: "Driver Two", phone: "9000000004", notes: null });
    expect(m.saveTrip).toHaveBeenCalledWith(SESSION, staff.id, expect.objectContaining({ driverId: u(302) }), null);
  });

  it("hands the new driver back when the bus fails after them, so a second Save cannot add them twice", async () => {
    m.saveTrip.mockResolvedValue({ ok: false, code: "failed" });
    const result = await saveTripAction({ session: SESSION, draft: bus({ driverId: "new" }), expected: null, newDriver: { id: null, name: "Driver Two", phone: "", notes: "" } });
    expect(result).toEqual({ ok: false, message: W.answer.failed, driverId: u(302) });
  });

  it("offers only Fees' routes, never the No Transport row, but keeps a route already on the bus", async () => {
    const unknown = await saveTripAction({ session: SESSION, draft: bus({ stops: [{ routeId: ROUTE.gone, stopTime: "" }] }), expected: null });
    expect(!unknown.ok && unknown.fields).toEqual({ stops: "unknown" });
    const placeholder = await saveTripAction({ session: SESSION, draft: bus({ stops: [{ routeId: ROUTE.b, stopTime: "" }] }), expected: null });
    expect(!placeholder.ok && placeholder.fields).toEqual({ stops: "unknown" });
    expect(writes()).toBe(0);
    const kept = await saveTripAction({ session: SESSION, draft: bus({ id: u(401), stops: [{ routeId: ROUTE.gone, stopTime: "" }] }), expected: "2026-11-07T10:00:00Z" });
    expect(kept.ok).toBe(true);
  });

  it("says when the bus tables are not set up yet", async () => {
    m.fleet.mockResolvedValue({ ready: false });
    expect(await saveTripAction({ session: SESSION, draft: bus(), expected: null })).toEqual({ ok: false, message: W.answer.not_set_up });
    expect(writes()).toBe(0);
  });
});

describe("getting route names again", () => {
  it("never asks Fees for a TEST year", async () => {
    expect((await refreshRouteNamesAction({ session: SESSION })).ok).toBe(true);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("asks Fees for the real year, at most once in ten minutes", async () => {
    m.session.mockResolvedValue("2026-27");
    m.canonical.mockReturnValue(true);
    m.refresh.mockResolvedValueOnce({ ok: true, count: 22 });
    expect(await refreshRouteNamesAction({ session: "2026-27" })).toEqual({ ok: true, message: W.refreshed(22) });
    expect(m.refresh).toHaveBeenCalledWith();
    m.refresh.mockResolvedValueOnce({ ok: false, code: "recent", waitMinutes: 7 });
    expect(await refreshRouteNamesAction({ session: "2026-27" })).toEqual({ ok: false, message: W.refreshRecent(7) });
  });
});
