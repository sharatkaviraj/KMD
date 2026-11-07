import { describe, expect, it } from "vitest";

import {
  buildBoard,
  checkDriver,
  checkTrip,
  draftOf,
  emptyTrip,
  moveStop,
  normalisePhone,
  normaliseTime,
  returnTripOf,
  searchBoard,
  suggestedShift,
  telHref,
  TRIP_LIMITS,
  type Driver,
  type Rider,
  type RouteInfo,
  type Trip,
  type TripDraft,
} from "@/modules/transport/domain/board";

/*
 * Transport's pure rules (D-550), on made-up routes, children and drivers.
 * No real name or phone number: test data only (CLAUDE.md rule 6).
 */

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ROUTE = { a: u(1), b: u(2), c: u(3), none: u(4), quiet: u(5), unnamed: u(6) };
const routes: RouteInfo[] = [
  { id: ROUTE.b, name: "Route Beta", code: "RB", isActive: true, placeholder: false },
  { id: ROUTE.a, name: "Route Alpha", code: null, isActive: true, placeholder: false },
  { id: ROUTE.c, name: "Route Gamma", code: null, isActive: true, placeholder: false },
  { id: ROUTE.none, name: "No Transport", code: null, isActive: true, placeholder: true },
  { id: ROUTE.quiet, name: "Route Quiet", code: null, isActive: true, placeholder: false },
];

const rider = (n: number, routeId: string, classOrder: number, name: string): Rider => ({
  id: u(100 + n),
  name,
  admissionNo: `T-${n}`,
  classId: u(200 + classOrder),
  classLabel: `Class ${classOrder}`,
  classOrder,
  routeId,
  photo: null,
});

const riders: Rider[] = [
  rider(1, ROUTE.a, 5, "Test Child Two"),
  rider(2, ROUTE.a, 2, "Test Child One"),
  rider(3, ROUTE.a, 5, "Test Child Three"),
  rider(4, ROUTE.b, 1, "Test Child Four"),
  rider(5, ROUTE.none, 3, "Test Child Walks"),
  rider(6, ROUTE.unnamed, 4, "Test Child Far"),
];

const drivers: Driver[] = [
  { id: u(301), name: "Driver Zed", phone: "9000000001", notes: null, updatedAt: "2026-11-07T10:00:00Z" },
  { id: u(302), name: "Driver Ann", phone: null, notes: null, updatedAt: "2026-11-07T10:00:00Z" },
];

const trip = (n: number, patch: Partial<Trip>): Trip => ({
  id: u(400 + n),
  shift: "morning",
  startsAt: "07:05",
  busName: `Bus ${n}`,
  vehicleNo: null,
  driverId: null,
  helperName: null,
  helperPhone: null,
  notes: null,
  stops: [],
  updatedAt: "2026-11-07T10:00:00Z",
  ...patch,
});

const trips: Trip[] = [
  trip(2, { startsAt: "07:30", driverId: u(301), stops: [{ routeId: ROUTE.b, stopTime: null }, { routeId: ROUTE.a, stopTime: "07:45" }] }),
  trip(1, { startsAt: "06:50", driverId: u(302), stops: [{ routeId: ROUTE.c, stopTime: null }] }),
  trip(3, { shift: "afternoon", startsAt: "13:40", stops: [{ routeId: ROUTE.a, stopTime: null }, { routeId: ROUTE.none, stopTime: null }] }),
];

describe("Transport board", () => {
  const board = buildBoard({ routes, riders, trips, drivers });

  it("leaves the No Transport children out of the buses", () => {
    expect(board.totals.riders).toBe(5);
    expect(board.cards.map((c) => c.id)).not.toContain(ROUTE.none);
    const afternoon = board.trips.find((t) => t.shift === "afternoon")!;
    expect(afternoon.riders).toBe(3);
    expect(afternoon.stopViews.find((s) => s.routeId === ROUTE.none)?.riders).toBe(0);
  });

  it("shows a route with children or a bus, named ones A to Z and unnamed ones last", () => {
    expect(board.cards.map((c) => c.id)).toEqual([ROUTE.a, ROUTE.b, ROUTE.c, ROUTE.unnamed]);
    const unnamed = board.cards.at(-1)!;
    expect(unnamed.known).toBe(false);
    expect(unnamed.riders).toHaveLength(1);
    expect(board.quietRoutes).toBe(1);
  });

  it("lists a route's children in school order, then by name, with a line per class", () => {
    const alpha = board.cards.find((c) => c.id === ROUTE.a)!;
    expect(alpha.riders.map((r) => r.name)).toEqual(["Test Child One", "Test Child Three", "Test Child Two"]);
    expect(alpha.classes).toEqual([{ label: "Class 2", count: 1 }, { label: "Class 5", count: 2 }]);
  });

  it("says which buses and drivers come to each route", () => {
    const alpha = board.cards.find((c) => c.id === ROUTE.a)!;
    expect(alpha.visits.map((v) => [v.shift, v.busName, v.stopTime, v.driver?.name ?? null])).toEqual([
      ["morning", "Bus 2", "07:45", "Driver Zed"],
      ["afternoon", "Bus 3", null, null],
    ]);
  });

  it("finds the gaps only where children ride", () => {
    expect(board.noMorning).toEqual([ROUTE.unnamed]);
    expect(board.noAfternoon.sort()).toEqual([ROUTE.b, ROUTE.unnamed].sort());
    expect(board.noDriver).toEqual([u(403)]);
  });

  it("orders bus runs by time of day and gives each driver their buses", () => {
    expect(board.trips.map((t) => t.busName)).toEqual(["Bus 1", "Bus 2", "Bus 3"]);
    expect(board.drivers.map((d) => [d.name, d.trips.map((t) => t.busName)])).toEqual([
      ["Driver Ann", ["Bus 1"]],
      ["Driver Zed", ["Bus 2"]],
    ]);
    expect(board.totals).toEqual({ riders: 5, routes: 3, trips: 3, drivers: 2 });
  });

  it("searches children, routes, buses and drivers, and a child brings their route", () => {
    const child = searchBoard(board, "child four");
    expect(child.riders.map((r) => r.name)).toEqual(["Test Child Four"]);
    expect(child.cards.map((c) => c.id)).toEqual([ROUTE.b]);
    expect(child.trips.map((t) => t.busName)).toEqual(["Bus 2"]);
    expect(searchBoard(board, "rb").cards.map((c) => c.id)).toEqual([ROUTE.b]);
    expect(searchBoard(board, "7:30").trips.map((t) => t.busName)).toEqual(["Bus 2"]);
    expect(searchBoard(board, "0001").drivers.map((d) => d.name)).toEqual(["Driver Zed"]);
    // Three digits are not a phone number.
    expect(searchBoard(board, "000").drivers).toEqual([]);
    expect(searchBoard(board, "  ").riders).toEqual([]);
  });
});

describe("Transport small rules", () => {
  it("reads a time the way staff type it", () => {
    expect(normaliseTime("7:05")).toBe("07:05");
    expect(normaliseTime("07:05:00")).toBe("07:05");
    expect(normaliseTime(" 13:40 ")).toBe("13:40");
    for (const bad of ["24:00", "7:60", "7", "seven", "", null]) expect(normaliseTime(bad)).toBeNull();
  });

  it("reads a mobile number with +91, 91, 0, spaces or dashes", () => {
    for (const ok of ["9000000001", "+91 90000 00001", "91-9000000001", "09000000001", "(900) 000-0001"]) expect(normalisePhone(ok)).toBe("9000000001");
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("   ")).toBeNull();
    for (const bad of ["12345", "90000000012", "phone"]) expect(normalisePhone(bad)).toBe("invalid");
    expect(telHref("9000000001")).toBe("tel:+919000000001");
  });

  it("makes the afternoon run from a morning one: same bus and driver, routes the other way, no times", () => {
    const morning = trips[0];
    const back = returnTripOf(morning);
    expect(back).toMatchObject({ id: null, shift: "afternoon", startsAt: "", busName: "Bus 2", driverId: u(301), notes: "" });
    expect(back.stops).toEqual([{ routeId: ROUTE.a, stopTime: "" }, { routeId: ROUTE.b, stopTime: "" }]);
    expect(returnTripOf({ ...morning, shift: "afternoon" }).shift).toBe("morning");
    expect(draftOf(morning).stops[1]).toEqual({ routeId: ROUTE.a, stopTime: "07:45" });
  });

  it("moves a route up or down, and never off the ends", () => {
    expect(moveStop(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveStop(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveStop(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveStop(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("suggests the shift with fewer buses", () => {
    expect(suggestedShift([])).toBe("morning");
    expect(suggestedShift([{ shift: "morning" }])).toBe("afternoon");
    expect(suggestedShift([{ shift: "morning" }, { shift: "afternoon" }])).toBe("morning");
  });
});

describe("Checking a bus before it is saved", () => {
  const known = { routes: new Set([ROUTE.a, ROUTE.b]), drivers: new Set([u(301)]) };
  const good = (): TripDraft => ({
    ...emptyTrip("morning", [ROUTE.a, ROUTE.b]),
    startsAt: "7:05",
    busName: "  Bus 9 ",
    vehicleNo: "rj 00 pa 0000",
    driverId: u(301),
    helperPhone: "+91 90000 00002",
  });

  it("takes a good bus and tidies it", () => {
    const checked = checkTrip(good(), known);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value).toMatchObject({ startsAt: "07:05", busName: "Bus 9", vehicleNo: "RJ 00 PA 0000", driverId: u(301), helperPhone: "9000000002", helperName: null, notes: null });
    expect(checked.value.stops).toEqual([{ routeId: ROUTE.a, stopTime: null }, { routeId: ROUTE.b, stopTime: null }]);
    expect("id" in checked.value).toBe(false);
  });

  it("marks every box that is wrong", () => {
    const checked = checkTrip({ ...good(), startsAt: "", busName: " ", helperPhone: "123", driverId: u(999) }, known);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.errors).toEqual({ startsAt: "required", busName: "required", helperPhone: "phone", driverId: "unknown" });
    const late = checkTrip({ ...good(), startsAt: "25:00" }, known);
    expect(!late.ok && late.errors.startsAt).toBe("time");
  });

  it("refuses no routes, a route twice, a route not offered, a bad route time and too many routes", () => {
    const stops = (list: { routeId: string; stopTime: string }[]) => checkTrip({ ...good(), stops: list }, known);
    const problem = (result: ReturnType<typeof checkTrip>) => (result.ok ? null : result.errors.stops);
    expect(problem(stops([]))).toBe("no_stops");
    expect(problem(stops([{ routeId: ROUTE.a, stopTime: "" }, { routeId: ROUTE.a, stopTime: "" }]))).toBe("duplicate");
    expect(problem(stops([{ routeId: ROUTE.c, stopTime: "" }]))).toBe("unknown");
    expect(problem(stops([{ routeId: ROUTE.a, stopTime: "7.45" }]))).toBe("stop_time");
    const many = Array.from({ length: TRIP_LIMITS.stops + 1 }, (_, i) => ({ routeId: u(1000 + i), stopTime: "" }));
    expect(problem(checkTrip({ ...good(), stops: many }, { routes: null, drivers: null }))).toBe("too_many");
  });

  it("checks route and driver ids only against lists it was given", () => {
    const checked = checkTrip({ ...good(), driverId: u(999), stops: [{ routeId: ROUTE.c, stopTime: "07:50" }] }, { routes: null, drivers: null });
    expect(checked.ok).toBe(true);
    // A made-up id is never a route, list or no list.
    expect(checkTrip({ ...good(), stops: [{ routeId: "not-a-route", stopTime: "" }] }, { routes: null, drivers: null }).ok).toBe(false);
  });

  it("matches the database's limit on routes per bus", () => {
    expect(TRIP_LIMITS.stops).toBe(40);
  });
});

describe("Checking a driver", () => {
  it("takes a name and an optional ten-digit phone", () => {
    expect(checkDriver({ id: null, name: "  Driver   New ", phone: "", notes: "" })).toEqual({ ok: true, value: { name: "Driver New", phone: null, notes: null } });
    expect(checkDriver({ id: null, name: "Driver New", phone: "0 90000 00003", notes: " Licence ok " })).toEqual({ ok: true, value: { name: "Driver New", phone: "9000000003", notes: "Licence ok" } });
  });
  it("refuses an empty name, a short phone and long notes", () => {
    const checked = checkDriver({ id: null, name: " ", phone: "12345", notes: "x".repeat(301) });
    expect(checked).toEqual({ ok: false, errors: { name: "required", phone: "phone", notes: "long" } });
  });
});
