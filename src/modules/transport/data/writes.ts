import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import type { DriverInput, TripInput } from "../domain/board";
import { missingTable } from "./missing";

/*
 * Transport writes (D-550). A library, not a door: the server actions in
 * `src/app/(app)/transport/actions.ts` check `transport:manage`, refuse a
 * "see the app as" preview and fence the session before they call these.
 * Every statement names the session as well as the id, so an id from one
 * year can never change a row of another.
 */

export type WriteCode = "not_set_up" | "not_found" | "changed" | "driver_missing" | "duplicate_stop" | "bad_request" | "failed";
export type Written<T> = { ok: true; value: T } | { ok: false; code: WriteCode };

type PgError = { code?: string | null; message?: string | null } | null;

function codeOf(error: PgError): WriteCode {
  if (missingTable(error)) return "not_set_up";
  const message = error?.message ?? "";
  for (const code of ["not_found", "changed", "driver_missing", "duplicate_stop", "bad_request"] as const) {
    if (message.includes(`transport:${code}`)) return code;
  }
  if (error?.code === "23503") return "driver_missing";
  if (error?.code === "23514" || error?.code === "22007" || error?.code === "22P02") return "bad_request";
  return "failed";
}

export async function saveDriver(sessionLabel: string, actorId: string, id: string | null, input: DriverInput): Promise<Written<{ id: string }>> {
  const db = createAdminClient();
  const row = { full_name: input.name, phone: input.phone, notes: input.notes, updated_by: actorId };
  if (id) {
    const { data, error } = await db.from("transport_drivers")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id).eq("session_label", sessionLabel)
      .select("id").maybeSingle<{ id: string }>();
    if (error) return { ok: false, code: codeOf(error) };
    if (!data) return { ok: false, code: "not_found" };
    return { ok: true, value: data };
  }
  const { data, error } = await db.from("transport_drivers")
    .insert({ ...row, session_label: sessionLabel, created_by: actorId })
    .select("id").single<{ id: string }>();
  if (error) return { ok: false, code: codeOf(error) };
  return { ok: true, value: data };
}

/** The driver goes; their buses stay, with no driver (the foreign key sets it null). */
export async function removeDriver(sessionLabel: string, id: string): Promise<Written<null>> {
  const { data, error } = await createAdminClient().from("transport_drivers")
    .delete().eq("id", id).eq("session_label", sessionLabel).select("id");
  if (error) return { ok: false, code: codeOf(error) };
  if (!data?.length) return { ok: false, code: "not_found" };
  return { ok: true, value: null };
}

/** A trip and its stops together, through the one SQL writer. `expected` refuses a stale editor. */
export async function saveTrip(sessionLabel: string, actorId: string, input: TripInput, expected: string | null): Promise<Written<{ id: string; updatedAt: string }>> {
  const { data, error } = await createAdminClient().rpc("transport_save_trip", {
    p_actor: actorId,
    p_session: sessionLabel,
    p_trip: input,
    p_expected: expected,
  });
  if (error) return { ok: false, code: codeOf(error) };
  const saved = data as { id?: string; updatedAt?: string } | null;
  if (!saved?.id) return { ok: false, code: "failed" };
  return { ok: true, value: { id: saved.id, updatedAt: String(saved.updatedAt ?? "") } };
}

/** The trip and its stops (they cascade). */
export async function removeTrip(sessionLabel: string, id: string): Promise<Written<null>> {
  const { data, error } = await createAdminClient().from("transport_trips")
    .delete().eq("id", id).eq("session_label", sessionLabel).select("id");
  if (error) return { ok: false, code: codeOf(error) };
  if (!data?.length) return { ok: false, code: "not_found" };
  return { ok: true, value: null };
}
