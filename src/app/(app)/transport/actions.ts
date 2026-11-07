"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import {
  checkDriver,
  checkTrip,
  isUuid,
  type DriverDraft,
  type TripDraft,
} from "@/modules/transport/domain/board";
import { readFleet } from "@/modules/transport/data/fleet";
import { readRoutes, refreshRouteCopy } from "@/modules/transport/data/routes";
import { removeDriver, removeTrip, saveDriver, saveTrip, type WriteCode } from "@/modules/transport/data/writes";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import type { Pair } from "@/vx/text";
import { W } from "@/vx/screens/transport/words";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Transport writes (D-550). Every one: `transport:manage`, then no "see the
 * app as" preview, then the session the screen showed must be the one this
 * account is on now and one it may write. Then the library in
 * `src/modules/transport/data/writes.ts`, which names the session in every
 * statement.
 */

export type TransportResult =
  | { ok: true; message: Pair; id?: string; updatedAt?: string }
  | {
      ok: false;
      message: Pair;
      /** Box name → problem code, for the boxes to mark in red. */
      fields?: Record<string, string>;
      /** A driver typed into the bus form was added although the bus was not saved. */
      driverId?: string;
    };

/** The draft's own marker for "a driver typed into the bus form". */
const NEW_DRIVER = "new";
const SESSION = /^(TEST-|UAT-|DEMO-)?\d{4}-\d{2}$/;

type Refusal = Extract<TransportResult, { ok: false }>;

const refuse = (code: WriteCode | keyof typeof W.answer): Refusal => ({ ok: false, message: W.answer[code] });

type Door = { ok: true; actorId: string; session: string; canonical: boolean } | { ok: false; result: TransportResult };

/**
 * The checks every write passes, in order. `asking` is the caller's own
 * `assertPermission(...)`, so each action names its permission where it is
 * declared (and tests/action-guards.test.ts can see it there).
 */
async function door(shownSession: unknown, asking: Promise<CurrentStaff>): Promise<Door> {
  let staff: CurrentStaff;
  try {
    staff = await asking;
  } catch {
    return { ok: false, result: refuse("denied") };
  }
  try {
    await assertNotPreviewing();
  } catch {
    return { ok: false, result: refuse("preview") };
  }
  if (typeof shownSession !== "string" || !SESSION.test(shownSession)) return { ok: false, result: refuse("bad_request") };
  const current = await resolveSessionLabel();
  if (current !== shownSession) return { ok: false, result: refuse("session") };
  try {
    await assertSessionWritable(staff, shownSession);
  } catch {
    return { ok: false, result: refuse("session") };
  }
  return { ok: true, actorId: staff.id, session: shownSession, canonical: usesCanonicalFees(staff, shownSession) };
}

function done(message: Pair, extra: { id?: string; updatedAt?: string } = {}): TransportResult {
  revalidatePath("/transport");
  return { ok: true, message, ...extra };
}

export async function saveDriverAction(input: { session: string; draft: DriverDraft }): Promise<TransportResult> {
  const gate = await door(input?.session, assertPermission("transport:manage"));
  if (!gate.ok) return gate.result;
  const draft = input.draft;
  if (!draft || (draft.id !== null && !isUuid(draft.id))) return refuse("bad_request");
  const checked = checkDriver({ id: draft.id, name: String(draft.name ?? ""), phone: String(draft.phone ?? ""), notes: String(draft.notes ?? "") });
  if (!checked.ok) return { ok: false, message: W.fixAbove, fields: checked.errors };
  const saved = await saveDriver(gate.session, gate.actorId, draft.id, checked.value);
  if (!saved.ok) return refuse(saved.code);
  return done(W.savedDriver, { id: saved.value.id });
}

export async function deleteDriverAction(input: { session: string; id: string }): Promise<TransportResult> {
  const gate = await door(input?.session, assertPermission("transport:manage"));
  if (!gate.ok) return gate.result;
  if (!isUuid(input.id)) return refuse("bad_request");
  const removed = await removeDriver(gate.session, input.id);
  if (!removed.ok) return refuse(removed.code);
  return done(W.removedDriver);
}

/**
 * A bus run and its routes. With `newDriver`, the driver typed into the bus
 * form is added and the bus given to them, so one Save does both. The whole
 * form is checked before the driver is added; if the bus still fails to save
 * after that, the answer carries the new driver's id, so the form picks them
 * and a second Save cannot add them twice.
 */
export async function saveTripAction(input: { session: string; draft: TripDraft; expected: string | null; newDriver?: DriverDraft | null }): Promise<TransportResult> {
  const gate = await door(input?.session, assertPermission("transport:manage"));
  if (!gate.ok) return gate.result;
  const draft = input.draft;
  if (!draft || !Array.isArray(draft.stops)) return refuse("bad_request");
  if (input.expected !== null && (typeof input.expected !== "string" || Number.isNaN(Date.parse(input.expected)))) return refuse("bad_request");

  const fleet = await readFleet(gate.session).catch(() => null);
  if (!fleet) return refuse("failed");
  if (!fleet.ready) return refuse("not_set_up");
  // The ids the screen offered. A route list that cannot be read now is not
  // a reason to refuse: the database keeps a stop's route as it was given.
  const routes = await readRoutes(gate.canonical, (task) => after(task)).catch(() => null);
  const knownRoutes = routes && routes.routes.length ? new Set(routes.routes.filter((r) => !r.placeholder).map((r) => r.id)) : null;
  // A route already on this bus stays allowed, even if Fees has since stopped using it.
  const existing = draft.id ? fleet.trips.find((t) => t.id === draft.id) : undefined;
  existing?.stops.forEach((s) => knownRoutes?.add(s.routeId));

  // The bus is checked whole before a new driver is added, so a bus that
  // would be refused never leaves a driver behind it.
  const wantsNewDriver = String(draft.driverId ?? "") === NEW_DRIVER;
  const knownDrivers = new Set(fleet.drivers.map((d) => d.id));
  const checked = checkTrip(
    {
      id: draft.id ?? null,
      shift: draft.shift,
      startsAt: String(draft.startsAt ?? ""),
      busName: String(draft.busName ?? ""),
      vehicleNo: String(draft.vehicleNo ?? ""),
      driverId: wantsNewDriver ? "" : String(draft.driverId ?? ""),
      helperName: String(draft.helperName ?? ""),
      helperPhone: String(draft.helperPhone ?? ""),
      notes: String(draft.notes ?? ""),
      stops: draft.stops.map((s) => ({ routeId: String(s?.routeId ?? ""), stopTime: String(s?.stopTime ?? "") })),
    },
    { routes: knownRoutes, drivers: knownDrivers },
  );
  const fields: Record<string, string> = {};
  if (!checked.ok) for (const [field, problem] of Object.entries(checked.errors)) if (problem) fields[field] = problem;
  const nd = input.newDriver;
  const checkedDriver = wantsNewDriver ? checkDriver({ id: null, name: String(nd?.name ?? ""), phone: String(nd?.phone ?? ""), notes: "" }) : null;
  if (checkedDriver && !checkedDriver.ok) {
    for (const [field, problem] of Object.entries(checkedDriver.errors)) if (problem) fields[`newDriver.${field}`] = problem;
  }
  if (!checked.ok || Object.keys(fields).length) {
    return { ok: false, message: fields.form ? W.answer.bad_request : W.fixAbove, fields };
  }

  let trip = checked.value;
  let madeDriver: string | undefined;
  if (checkedDriver?.ok) {
    const created = await saveDriver(gate.session, gate.actorId, null, checkedDriver.value);
    if (!created.ok) return refuse(created.code);
    madeDriver = created.value.id;
    trip = { ...trip, driverId: madeDriver };
  }

  const saved = await saveTrip(gate.session, gate.actorId, trip, input.expected);
  if (!saved.ok) {
    if (madeDriver) revalidatePath("/transport");
    return madeDriver ? { ...refuse(saved.code), driverId: madeDriver } : refuse(saved.code);
  }
  return done(W.savedBus, { id: saved.value.id, updatedAt: saved.value.updatedAt });
}

export async function deleteTripAction(input: { session: string; id: string }): Promise<TransportResult> {
  const gate = await door(input?.session, assertPermission("transport:manage"));
  if (!gate.ok) return gate.result;
  if (!isUuid(input.id)) return refuse("bad_request");
  const removed = await removeTrip(gate.session, input.id);
  if (!removed.ok) return refuse(removed.code);
  return done(W.removedBus);
}

/** "Get route names again": the real year only, where the names come from Fees. */
export async function refreshRouteNamesAction(input: { session: string }): Promise<TransportResult> {
  const gate = await door(input?.session, assertPermission("transport:manage"));
  if (!gate.ok) return gate.result;
  if (!gate.canonical) return done(W.refreshed(0));
  const outcome = await refreshRouteCopy();
  if (outcome.ok) return done(W.refreshed(outcome.count));
  if (outcome.code === "recent" && "waitMinutes" in outcome) return { ok: false, message: W.refreshRecent(outcome.waitMinutes) };
  if (outcome.code === "transport_not_set_up") return refuse("not_set_up");
  return { ok: false, message: W.refreshFailed };
}
