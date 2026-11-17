import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { isJpeg, LIMITS, pagePath, type Missed, type ToiletInput, type ToiletSettings } from "../domain/checks";
import { missingTable } from "./missing";

/*
 * Toilet checks writes (D-652). A library, not a door: the server actions in
 * `src/app/(app)/toilets/actions.ts` check `toilets:upload` or
 * `toilets:manage`, refuse a "see the app as" preview and fence the session
 * before they call these. Every statement names the session as well as the
 * id, so an id from one year can never change a row of another. Nothing is
 * deleted: removing sets `removed_at`.
 */

export const TOILET_CHARTS_BUCKET = "toilet-charts";
/** Each photo is compressed on the phone to about 300 KB; the bucket refuses over 5 MB. */
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export type WriteCode = "not_set_up" | "not_found" | "duplicate" | "changed" | "bad_request" | "photo" | "storage" | "failed";
export type Written<T> = { ok: true; value: T } | { ok: false; code: WriteCode };

type PgError = { code?: string | null; message?: string | null } | null;

function codeOf(error: PgError): WriteCode {
  if (missingTable(error)) return "not_set_up";
  const message = error?.message ?? "";
  for (const code of ["not_found", "bad_request"] as const) if (message.includes(`toilets:${code}`)) return code;
  if (error?.code === "23505") return "duplicate";
  if (error?.code === "23503") return "not_found";
  if (error?.code === "23514" || error?.code === "22007" || error?.code === "22P02") return "bad_request";
  return "failed";
}

/* ---------------------------------------------------------------- toilets */

export async function saveToilet(
  sessionLabel: string,
  actorId: string,
  id: string | null,
  input: ToiletInput,
  expected: string | null,
): Promise<Written<{ id: string }>> {
  const db = createAdminClient();
  const row = { name: input.name, place: input.place, used_by: input.usedBy, updated_by: actorId };
  if (id) {
    let query = db.from("toilets").update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id).eq("session_label", sessionLabel).is("removed_at", null);
    if (expected) query = query.eq("updated_at", expected);
    const { data, error } = await query.select("id").maybeSingle<{ id: string }>();
    if (error) return { ok: false, code: codeOf(error) };
    if (!data) return { ok: false, code: expected ? "changed" : "not_found" };
    return { ok: true, value: data };
  }
  const { count, error: countError } = await db.from("toilets").select("id", { count: "exact", head: true })
    .eq("session_label", sessionLabel).is("removed_at", null);
  if (countError) return { ok: false, code: codeOf(countError) };
  if ((count ?? 0) >= LIMITS.toilets) return { ok: false, code: "bad_request" };
  const { data, error } = await db.from("toilets")
    .insert({ ...row, session_label: sessionLabel, created_by: actorId, position: (count ?? 0) + 1 })
    .select("id").single<{ id: string }>();
  if (error) return { ok: false, code: codeOf(error) };
  return { ok: true, value: data };
}

/** Off the list from now. Its charts stay, and so do the weeks it was checked. */
export async function removeToilet(sessionLabel: string, actorId: string, id: string): Promise<Written<null>> {
  const now = new Date().toISOString();
  const { data, error } = await createAdminClient().from("toilets")
    .update({ removed_at: now, updated_at: now, updated_by: actorId })
    .eq("id", id).eq("session_label", sessionLabel).is("removed_at", null).select("id");
  if (error) return { ok: false, code: codeOf(error) };
  if (!data?.length) return { ok: false, code: "not_found" };
  return { ok: true, value: null };
}

/** The new order, top to bottom. Ids not of this session are ignored by the filter. */
export async function orderToilets(sessionLabel: string, actorId: string, ids: string[]): Promise<Written<null>> {
  const db = createAdminClient();
  for (const [i, id] of ids.entries()) {
    const { error } = await db.from("toilets").update({ position: i + 1, updated_by: actorId })
      .eq("id", id).eq("session_label", sessionLabel).is("removed_at", null);
    if (error) return { ok: false, code: codeOf(error) };
  }
  return { ok: true, value: null };
}

/* --------------------------------------------------------------- settings */

export async function saveSettings(sessionLabel: string, actorId: string, input: Omit<ToiletSettings, "defaults">): Promise<Written<null>> {
  const { error } = await createAdminClient().from("toilet_settings").upsert({
    session_label: sessionLabel,
    morning_at: input.morningAt,
    afternoon_at: input.afternoonAt,
    checklist: input.checklist,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "session_label" });
  if (error) return { ok: false, code: codeOf(error) };
  return { ok: true, value: null };
}

/* ----------------------------------------------------------------- charts */

export type Begun = { paths: string[]; tokens: string[] };

/**
 * Starts one upload: the chart's row (the phone's own id, so a retry is the
 * same row) and a signed upload link for each page. A retry of the same id
 * by the same person gets fresh links for the same paths.
 */
export async function beginChart(input: {
  sessionLabel: string;
  actorId: string;
  chartId: string;
  toiletId: string;
  weekStart: string;
  pages: number;
}): Promise<Written<Begun>> {
  const db = createAdminClient();
  const { data: toilet, error: toiletError } = await db.from("toilets").select("id")
    .eq("id", input.toiletId).eq("session_label", input.sessionLabel).is("removed_at", null).maybeSingle();
  if (toiletError) return { ok: false, code: codeOf(toiletError) };
  if (!toilet) return { ok: false, code: "not_found" };

  const paths = Array.from({ length: input.pages }, (_, i) =>
    pagePath({ sessionLabel: input.sessionLabel, toiletId: input.toiletId, weekStart: input.weekStart, chartId: input.chartId, page: i + 1 }));
  const { error } = await db.from("toilet_charts").insert({
    id: input.chartId,
    session_label: input.sessionLabel,
    toilet_id: input.toiletId,
    week_start: input.weekStart,
    pages: paths,
    uploaded_by: input.actorId,
  });
  if (error && error.code !== "23505") return { ok: false, code: codeOf(error) };
  if (error) {
    // The same id again: only the same person's unfinished upload of the same thing.
    const { data: row } = await db.from("toilet_charts").select("session_label, toilet_id, week_start, pages, uploaded_by, upload_state")
      .eq("id", input.chartId).maybeSingle<{ session_label: string; toilet_id: string; week_start: string; pages: string[]; uploaded_by: string | null; upload_state: string }>();
    if (!row || row.session_label !== input.sessionLabel || row.toilet_id !== input.toiletId || row.week_start !== input.weekStart ||
        row.uploaded_by !== input.actorId || row.pages.join("|") !== paths.join("|")) return { ok: false, code: "bad_request" };
    if (row.upload_state === "stored") return { ok: true, value: { paths, tokens: [] } };
  }

  const tokens: string[] = [];
  for (const path of paths) {
    const { data, error: signError } = await db.storage.from(TOILET_CHARTS_BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (signError || !data?.token) return { ok: false, code: "storage" };
    tokens.push(data.token);
  }
  return { ok: true, value: { paths, tokens } };
}

/**
 * Checks every page is there and is a JPEG of a sane size, then makes the
 * chart the week's chart through `toilet_chart_store` (which also sets an
 * older chart for the same week aside).
 */
export async function finishChart(input: {
  sessionLabel: string;
  actorId: string;
  chartId: string;
  missed: Missed[];
  note: string | null;
}): Promise<Written<{ storedAt: string }>> {
  const db = createAdminClient();
  const { data: row, error } = await db.from("toilet_charts").select("pages, uploaded_by, upload_state, stored_at")
    .eq("id", input.chartId).eq("session_label", input.sessionLabel)
    .maybeSingle<{ pages: string[]; uploaded_by: string | null; upload_state: string; stored_at: string | null }>();
  if (error) return { ok: false, code: codeOf(error) };
  if (!row || row.uploaded_by !== input.actorId) return { ok: false, code: "not_found" };
  if (row.upload_state === "stored") return { ok: true, value: { storedAt: row.stored_at ?? new Date().toISOString() } };

  for (const path of row.pages) {
    const { data: object, error: downloadError } = await db.storage.from(TOILET_CHARTS_BUCKET).download(path);
    if (downloadError || !object) return { ok: false, code: "storage" };
    if (object.size <= 0 || object.size > MAX_PAGE_BYTES) return { ok: false, code: "photo" };
    const head = new Uint8Array(await object.slice(0, 4).arrayBuffer());
    if (!isJpeg(head)) return { ok: false, code: "photo" };
  }

  const { data, error: storeError } = await db.rpc("toilet_chart_store", {
    p_id: input.chartId,
    p_session: input.sessionLabel,
    p_actor: input.actorId,
    p_missed: input.missed,
    p_note: input.note,
  });
  if (storeError) return { ok: false, code: codeOf(storeError) };
  const stored = data as { storedAt?: string } | null;
  return { ok: true, value: { storedAt: String(stored?.storedAt ?? new Date().toISOString()) } };
}

/** A wrong photo off the week. The photo itself stays on the shelf, with the row. */
export async function removeChart(sessionLabel: string, actorId: string, chartId: string): Promise<Written<null>> {
  const { data, error } = await createAdminClient().from("toilet_charts")
    .update({ removed_at: new Date().toISOString(), removed_by: actorId })
    .eq("id", chartId).eq("session_label", sessionLabel).eq("upload_state", "stored").is("removed_at", null).select("id");
  if (error) return { ok: false, code: codeOf(error) };
  if (!data?.length) return { ok: false, code: "not_found" };
  return { ok: true, value: null };
}

/** One page's bytes, for the photo route. */
export async function pageBytes(path: string): Promise<Uint8Array | null> {
  const { data, error } = await createAdminClient().storage.from(TOILET_CHARTS_BUCKET).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  return isJpeg(bytes) ? bytes : null;
}
