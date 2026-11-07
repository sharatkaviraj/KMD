import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { isShift, normaliseTime, type Driver, type Trip } from "../domain/board";
import { missingTable } from "./missing";

/*
 * The school's own buses (D-550): drivers, trips and their stops, One's
 * tables, one session at a time. Read service-role after the page has
 * checked `transport:view`, and always filtered by the session, because the
 * service role does not see the TEST fence the tables carry for staff.
 */

export type Fleet = { ready: true; drivers: Driver[]; trips: Trip[] } | { ready: false };

type DriverRow = { id: string; full_name: string; phone: string | null; notes: string | null; updated_at: string };
type TripRow = {
  id: string;
  shift: string;
  starts_at: string;
  bus_name: string;
  vehicle_no: string | null;
  driver_id: string | null;
  helper_name: string | null;
  helper_phone: string | null;
  notes: string | null;
  updated_at: string;
  stops: { route_id: string; position: number; stop_time: string | null }[] | null;
};

export async function readFleet(sessionLabel: string): Promise<Fleet> {
  const db = createAdminClient();
  const [drivers, trips] = await Promise.all([
    db.from("transport_drivers").select("id,full_name,phone,notes,updated_at").eq("session_label", sessionLabel)
      .order("full_name").limit(500).returns<DriverRow[]>(),
    db.from("transport_trips")
      .select("id,shift,starts_at,bus_name,vehicle_no,driver_id,helper_name,helper_phone,notes,updated_at,stops:transport_trip_stops(route_id,position,stop_time)")
      .eq("session_label", sessionLabel).limit(500).returns<TripRow[]>(),
  ]);
  if (missingTable(drivers.error) || missingTable(trips.error)) return { ready: false };
  if (drivers.error || trips.error) throw new Error("transport_fleet_unreadable");
  return {
    ready: true,
    drivers: drivers.data.map((d) => ({ id: d.id, name: d.full_name, phone: d.phone, notes: d.notes, updatedAt: d.updated_at })),
    trips: trips.data.filter((t) => isShift(t.shift)).map((t) => ({
      id: t.id,
      shift: t.shift as Trip["shift"],
      startsAt: normaliseTime(t.starts_at) ?? t.starts_at,
      busName: t.bus_name,
      vehicleNo: t.vehicle_no,
      driverId: t.driver_id,
      helperName: t.helper_name,
      helperPhone: t.helper_phone,
      notes: t.notes,
      updatedAt: t.updated_at,
      stops: [...(t.stops ?? [])].sort((a, b) => a.position - b.position).map((s) => ({ routeId: s.route_id, stopTime: normaliseTime(s.stop_time) })),
    })),
  };
}
