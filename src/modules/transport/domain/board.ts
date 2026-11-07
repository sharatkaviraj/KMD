/*
 * Transport (owner, 7 Nov 2026, D-550): the pure rules behind the Transport
 * screen. No database, no framework, no words — the screen turns the codes
 * here into sentences (`src/vx/screens/transport/words.ts`).
 *
 * Three things, and how they meet:
 *  - a ROUTE is Fees' transport route (a village or an area of town). Fees
 *    owns the list and which route each child is on; One only reads it.
 *  - a TRIP is one bus run at one time of day: the morning pickup, the
 *    afternoon drop or another run. It has a bus, a driver, a helper, and the
 *    routes it reaches in order (its stops), each with an optional time.
 *  - a DRIVER belongs to one session and drives any number of trips.
 *
 * A child rides every trip that stops at their route. So "who is on the 7:05
 * bus" is the children of its stops, and "which driver goes to this village" is the
 * drivers of the trips that stop there. Nothing is stored twice.
 */

export const SHIFTS = ["morning", "afternoon", "other"] as const;
export type Shift = (typeof SHIFTS)[number];

export function isShift(value: unknown): value is Shift {
  return typeof value === "string" && (SHIFTS as readonly string[]).includes(value);
}

export type RouteInfo = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  /** Fees' "No Transport" row: a placeholder, not a bus route. */
  placeholder: boolean;
};

/** Where the route names came from: One's copy of Fees' list, Fees just now, the local TEST list, or nowhere. */
export type RouteSource = "copy" | "fees" | "local" | "none";

export type Rider = {
  id: string;
  name: string;
  admissionNo: string | null;
  classId: string;
  classLabel: string;
  /** The class's place in the school's order, for sorting. */
  classOrder: number;
  routeId: string;
  photo: string | null;
};

export type Driver = { id: string; name: string; phone: string | null; notes: string | null; updatedAt: string };

export type TripStop = { routeId: string; stopTime: string | null };

export type Trip = {
  id: string;
  shift: Shift;
  /** "HH:MM", 24-hour. */
  startsAt: string;
  busName: string;
  vehicleNo: string | null;
  driverId: string | null;
  helperName: string | null;
  helperPhone: string | null;
  notes: string | null;
  /** In the order the bus reaches them. */
  stops: TripStop[];
  updatedAt: string;
};

/* ------------------------------------------------------------- small rules */

/** "7:05", "07:05" or "07:05:00" → "07:05"; anything else → null. */
export function normaliseTime(raw: string | null | undefined): string | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(raw ?? "");
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minutes after midnight, for sorting; an unreadable time sorts last. */
export function minutesOf(time: string | null | undefined): number {
  const t = normaliseTime(time);
  if (!t) return 24 * 60;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
}

/**
 * A phone number as staff type it: spaces, dashes, a +91, 91 or 0 in front.
 * Returns the ten digits, null for an empty box, or "invalid".
 */
export function normalisePhone(raw: string | null | undefined): string | null | "invalid" {
  const digits = String(raw ?? "").replace(/[\s\-().]/g, "");
  if (!digits) return null;
  let d = digits.startsWith("+") ? digits.slice(1) : digits;
  if (!/^\d+$/.test(d)) return "invalid";
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.length === 10 ? d : "invalid";
}

/** A link that rings the number on a phone. */
export function telHref(phone: string): string {
  return `tel:+91${phone}`;
}

const SHIFT_ORDER: Record<Shift, number> = { morning: 0, afternoon: 1, other: 2 };

export function compareTrips(a: Pick<Trip, "shift" | "startsAt" | "busName">, b: Pick<Trip, "shift" | "startsAt" | "busName">): number {
  return (
    SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift] ||
    minutesOf(a.startsAt) - minutesOf(b.startsAt) ||
    a.busName.localeCompare(b.busName, "en", { numeric: true, sensitivity: "base" })
  );
}

export function compareRiders(a: Rider, b: Rider): number {
  return a.classOrder - b.classOrder || a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });

/* ------------------------------------------------------------------ board */

export type StopView = { routeId: string; name: string; known: boolean; stopTime: string | null; riders: number };

export type TripView = Trip & { driver: Driver | null; stopViews: StopView[]; riders: number };

export type Visit = { tripId: string; shift: Shift; startsAt: string; stopTime: string | null; busName: string; driver: Driver | null };

export type RouteCard = {
  id: string;
  name: string;
  /** False when Fees has not told One this route's name yet. */
  known: boolean;
  code: string | null;
  riders: Rider[];
  /** "Class 5 · 3" lines, in school order. */
  classes: { label: string; count: number }[];
  /** The trips that stop here, morning first. */
  visits: Visit[];
};

export type DriverView = Driver & { trips: TripView[] };

export type Board = {
  cards: RouteCard[];
  trips: TripView[];
  drivers: DriverView[];
  /** Routes in Fees' list that no child rides and no bus visits. */
  quietRoutes: number;
  /** Ids of routes with children and no morning trip, and none in the afternoon. */
  noMorning: string[];
  noAfternoon: string[];
  /** Trips with no driver yet. */
  noDriver: string[];
  totals: { riders: number; routes: number; trips: number; drivers: number };
};

export function buildBoard(input: { routes: readonly RouteInfo[]; riders: readonly Rider[]; trips: readonly Trip[]; drivers: readonly Driver[] }): Board {
  const routeById = new Map(input.routes.map((r) => [r.id, r]));
  const placeholder = new Set(input.routes.filter((r) => r.placeholder).map((r) => r.id));
  const driverById = new Map(input.drivers.map((d) => [d.id, d]));

  // A child on the "No Transport" row does not ride a bus.
  const riders = input.riders.filter((r) => !placeholder.has(r.routeId));
  const ridersByRoute = new Map<string, Rider[]>();
  for (const rider of riders) {
    const list = ridersByRoute.get(rider.routeId) ?? [];
    list.push(rider);
    ridersByRoute.set(rider.routeId, list);
  }
  for (const list of ridersByRoute.values()) list.sort(compareRiders);

  const nameOf = (routeId: string) => {
    const route = routeById.get(routeId);
    return route ? { name: route.name, known: true } : { name: "", known: false };
  };

  const trips: TripView[] = [...input.trips].sort(compareTrips).map((trip) => {
    const stopViews = trip.stops.map((stop) => ({
      routeId: stop.routeId,
      ...nameOf(stop.routeId),
      stopTime: stop.stopTime,
      riders: placeholder.has(stop.routeId) ? 0 : ridersByRoute.get(stop.routeId)?.length ?? 0,
    }));
    return {
      ...trip,
      driver: trip.driverId ? driverById.get(trip.driverId) ?? null : null,
      stopViews,
      riders: stopViews.reduce((sum, s) => sum + s.riders, 0),
    };
  });

  const visitsByRoute = new Map<string, Visit[]>();
  for (const trip of trips) {
    for (const stop of trip.stopViews) {
      const list = visitsByRoute.get(stop.routeId) ?? [];
      list.push({ tripId: trip.id, shift: trip.shift, startsAt: trip.startsAt, stopTime: stop.stopTime, busName: trip.busName, driver: trip.driver });
      visitsByRoute.set(stop.routeId, list);
    }
  }

  const cardIds = new Set<string>([...ridersByRoute.keys(), ...[...visitsByRoute.keys()].filter((id) => !placeholder.has(id))]);
  const cards: RouteCard[] = [...cardIds].map((id) => {
    const route = routeById.get(id);
    const list = ridersByRoute.get(id) ?? [];
    const classes: RouteCard["classes"] = [];
    for (const rider of list) {
      const last = classes[classes.length - 1];
      if (last && last.label === rider.classLabel) last.count += 1;
      else classes.push({ label: rider.classLabel, count: 1 });
    }
    return {
      id,
      name: route?.name ?? "",
      known: Boolean(route),
      code: route?.code ?? null,
      riders: list,
      classes,
      visits: visitsByRoute.get(id) ?? [],
    };
  });
  // Named routes A to Z; any route Fees has not named yet goes last.
  cards.sort((a, b) => Number(b.known) - Number(a.known) || byName(a, b) || a.id.localeCompare(b.id));

  const drivers: DriverView[] = [...input.drivers].sort(byName).map((driver) => ({
    ...driver,
    trips: trips.filter((t) => t.driverId === driver.id),
  }));

  const withRiders = cards.filter((c) => c.riders.length > 0);
  const quietRoutes = input.routes.filter((r) => !r.placeholder && r.isActive && !cardIds.has(r.id)).length;

  return {
    cards,
    trips,
    drivers,
    quietRoutes,
    noMorning: withRiders.filter((c) => !c.visits.some((v) => v.shift === "morning")).map((c) => c.id),
    noAfternoon: withRiders.filter((c) => !c.visits.some((v) => v.shift === "afternoon")).map((c) => c.id),
    noDriver: trips.filter((t) => !t.driver).map((t) => t.id),
    totals: { riders: riders.length, routes: withRiders.length, trips: trips.length, drivers: drivers.length },
  };
}

/* ----------------------------------------------------------------- search */

/** Lower-case, accents and extra spaces gone, so "route a " finds "Route A". */
export function fold(text: string | null | undefined): string {
  return String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type BoardMatch = { cards: RouteCard[]; trips: TripView[]; drivers: DriverView[]; riders: Rider[] };

/**
 * What a search box finds: routes by name or code, buses by name, number or
 * time, drivers and helpers by name or phone, children by name or SR number.
 * A child found also brings their route, so the answer to "which bus does
 * this child take" is one tap away.
 */
export function searchBoard(board: Board, query: string): BoardMatch {
  const q = fold(query);
  if (!q) return { cards: board.cards, trips: board.trips, drivers: board.drivers, riders: [] };
  const hit = (...values: (string | null | undefined)[]) => values.some((v) => fold(v).includes(q));
  const digits = q.replace(/\D/g, "");
  const phoneHit = (phone: string | null | undefined) => digits.length >= 4 && Boolean(phone?.includes(digits));

  const riders = board.cards.flatMap((c) => c.riders).filter((r) => hit(r.name, r.admissionNo));
  const riderRoutes = new Set(riders.map((r) => r.routeId));
  const cards = board.cards.filter((c) => hit(c.name, c.code) || riderRoutes.has(c.id));
  const cardIds = new Set(cards.map((c) => c.id));
  const trips = board.trips.filter(
    (t) =>
      hit(t.busName, t.vehicleNo, t.startsAt, t.driver?.name, t.helperName) ||
      phoneHit(t.driver?.phone) ||
      phoneHit(t.helperPhone) ||
      t.stopViews.some((s) => cardIds.has(s.routeId)),
  );
  const drivers = board.drivers.filter((d) => hit(d.name) || phoneHit(d.phone) || d.trips.some((t) => trips.includes(t)));
  return { cards, trips, drivers, riders };
}

/* ------------------------------------------------------------------ edits */

export type TripDraft = {
  id: string | null;
  shift: Shift;
  startsAt: string;
  busName: string;
  vehicleNo: string;
  driverId: string;
  helperName: string;
  helperPhone: string;
  notes: string;
  stops: { routeId: string; stopTime: string }[];
};

/** What `vppsone.transport_save_trip` takes, as its `p_trip`. */
export type TripInput = {
  id?: string;
  shift: Shift;
  startsAt: string;
  busName: string;
  vehicleNo: string | null;
  driverId: string | null;
  helperName: string | null;
  helperPhone: string | null;
  notes: string | null;
  stops: { routeId: string; stopTime: string | null }[];
};

export type TripField = "form" | "shift" | "startsAt" | "busName" | "vehicleNo" | "driverId" | "helperName" | "helperPhone" | "notes" | "stops";
export type Problem = "required" | "time" | "long" | "phone" | "no_stops" | "too_many" | "duplicate" | "unknown" | "stop_time";

/** The SQL keeps the same limits (`transport_save_trip`, the table checks). */
export const TRIP_LIMITS = { busName: 40, vehicleNo: 20, helperName: 80, notes: 300, stops: 40 } as const;
export const DRIVER_LIMITS = { name: 80, notes: 300 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function emptyTrip(shift: Shift = "morning", stops: string[] = []): TripDraft {
  return { id: null, shift, startsAt: "", busName: "", vehicleNo: "", driverId: "", helperName: "", helperPhone: "", notes: "", stops: stops.map((routeId) => ({ routeId, stopTime: "" })) };
}

export function draftOf(trip: Trip): TripDraft {
  return {
    id: trip.id,
    shift: trip.shift,
    startsAt: trip.startsAt,
    busName: trip.busName,
    vehicleNo: trip.vehicleNo ?? "",
    driverId: trip.driverId ?? "",
    helperName: trip.helperName ?? "",
    helperPhone: trip.helperPhone ?? "",
    notes: trip.notes ?? "",
    stops: trip.stops.map((s) => ({ routeId: s.routeId, stopTime: s.stopTime ?? "" })),
  };
}

/**
 * The afternoon run from a morning one: the same bus, driver and helper, the
 * villages the other way round, and no times yet — the drop is later and the
 * times are not the morning's.
 */
export function returnTripOf(trip: Trip): TripDraft {
  return {
    ...draftOf(trip),
    id: null,
    shift: trip.shift === "morning" ? "afternoon" : trip.shift === "afternoon" ? "morning" : "other",
    startsAt: "",
    notes: "",
    stops: [...trip.stops].reverse().map((s) => ({ routeId: s.routeId, stopTime: "" })),
  };
}

/** Move one stop up (-1) or down (+1); out of range leaves the list as it was. */
export function moveStop<T>(stops: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= stops.length || to < 0 || to >= stops.length) return [...stops];
  const next = [...stops];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export type Checked<T, F extends string> = { ok: true; value: T } | { ok: false; errors: Partial<Record<F, Problem>> };

const text = (value: string) => value.trim();

/**
 * A trip as typed, checked, and turned into what the database takes. `known`
 * lists the route and driver ids the screen offers; null skips that check
 * (the database refuses a driver of another session itself).
 */
export function checkTrip(draft: TripDraft, known: { routes: ReadonlySet<string> | null; drivers: ReadonlySet<string> | null }): Checked<TripInput, TripField> {
  const errors: Partial<Record<TripField, Problem>> = {};
  if (draft.id !== null && !isUuid(draft.id)) errors.form = "unknown";
  if (!isShift(draft.shift)) errors.shift = "required";
  const startsAt = normaliseTime(draft.startsAt);
  if (!draft.startsAt.trim()) errors.startsAt = "required";
  else if (!startsAt) errors.startsAt = "time";
  const busName = text(draft.busName);
  if (!busName) errors.busName = "required";
  else if (busName.length > TRIP_LIMITS.busName) errors.busName = "long";
  const vehicleNo = text(draft.vehicleNo).toUpperCase();
  if (vehicleNo.length > TRIP_LIMITS.vehicleNo) errors.vehicleNo = "long";
  const driverId = draft.driverId.trim();
  if (driverId && (!isUuid(driverId) || (known.drivers && !known.drivers.has(driverId)))) errors.driverId = "unknown";
  const helperName = text(draft.helperName);
  if (helperName.length > TRIP_LIMITS.helperName) errors.helperName = "long";
  const helperPhone = normalisePhone(draft.helperPhone);
  if (helperPhone === "invalid") errors.helperPhone = "phone";
  const notes = text(draft.notes);
  if (notes.length > TRIP_LIMITS.notes) errors.notes = "long";

  const stops: TripInput["stops"] = [];
  const seen = new Set<string>();
  for (const stop of draft.stops) {
    if (!isUuid(stop.routeId) || (known.routes && !known.routes.has(stop.routeId))) {
      errors.stops = "unknown";
      break;
    }
    if (seen.has(stop.routeId)) {
      errors.stops = "duplicate";
      break;
    }
    seen.add(stop.routeId);
    const stopTime = stop.stopTime.trim() ? normaliseTime(stop.stopTime) : null;
    if (stop.stopTime.trim() && !stopTime) {
      errors.stops = "stop_time";
      break;
    }
    stops.push({ routeId: stop.routeId, stopTime });
  }
  if (!errors.stops && stops.length === 0) errors.stops = "no_stops";
  if (!errors.stops && stops.length > TRIP_LIMITS.stops) errors.stops = "too_many";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...(draft.id ? { id: draft.id } : {}),
      shift: draft.shift,
      startsAt: startsAt!,
      busName,
      vehicleNo: vehicleNo || null,
      driverId: driverId || null,
      helperName: helperName || null,
      helperPhone: helperPhone === "invalid" ? null : helperPhone,
      notes: notes || null,
      stops,
    },
  };
}

export type DriverDraft = { id: string | null; name: string; phone: string; notes: string };
export type DriverInput = { name: string; phone: string | null; notes: string | null };
export type DriverField = "name" | "phone" | "notes";

export function checkDriver(draft: DriverDraft): Checked<DriverInput, DriverField> {
  const errors: Partial<Record<DriverField, Problem>> = {};
  const name = text(draft.name).replace(/\s+/g, " ");
  if (!name) errors.name = "required";
  else if (name.length > DRIVER_LIMITS.name) errors.name = "long";
  const phone = normalisePhone(draft.phone);
  if (phone === "invalid") errors.phone = "phone";
  const notes = text(draft.notes);
  if (notes.length > DRIVER_LIMITS.notes) errors.notes = "long";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, phone: phone === "invalid" ? null : phone, notes: notes || null } };
}

/** The shift a new trip should start on: whichever has fewer buses. */
export function suggestedShift(trips: readonly Pick<Trip, "shift">[]): Shift {
  const morning = trips.filter((t) => t.shift === "morning").length;
  const afternoon = trips.filter((t) => t.shift === "afternoon").length;
  return afternoon < morning ? "afternoon" : "morning";
}
