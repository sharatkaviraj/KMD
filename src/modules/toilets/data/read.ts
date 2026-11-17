import "server-only";

import { isSchoolOpen } from "@/modules/academics/domain/calendar";
import { schoolCalendar } from "@/modules/attendance/data/attendance-repo";
import { createAdminClient } from "@/platform/supabase/admin";

import {
  addDays,
  DEFAULT_CHECKLIST,
  DEFAULT_TIMES,
  LOOK_BACK_WEEKS,
  normaliseTime,
  weekStartOf,
  findGaps,
  type Chart,
  type CheckItem,
  type Missed,
  type Toilet,
  type ToiletSettings,
  type UsedBy,
} from "../domain/checks";
import { missingTable } from "./missing";

/*
 * Toilet checks reads (D-652): the toilets, the settings and the charts of
 * one session, service role after the page has checked `toilets:view`, and
 * always filtered by the session, because the service role does not see the
 * TEST fence the tables carry for staff.
 */

export type ToiletData =
  | { ready: true; toilets: Toilet[]; settings: ToiletSettings; charts: Chart[]; isOpen: (day: string) => boolean }
  | { ready: false };

type ToiletRow = { id: string; name: string; place: string | null; used_by: string; position: number; created_at: string; removed_at: string | null; updated_at: string };
type SettingsRow = { morning_at: string; afternoon_at: string; checklist: unknown };
type ChartRow = { id: string; toilet_id: string; week_start: string; pages: string[]; missed: unknown; note: string | null; uploaded_by: string | null; stored_at: string };

export const toiletOf = (r: ToiletRow): Toilet => ({
  id: r.id,
  name: r.name,
  place: r.place,
  usedBy: (["boys", "girls", "staff", "all"].includes(r.used_by) ? r.used_by : "all") as UsedBy,
  position: r.position,
  createdAt: r.created_at,
  removedAt: r.removed_at,
  updatedAt: r.updated_at,
});

function checklistOf(value: unknown): CheckItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value
    .map((v) => ({ en: typeof v?.en === "string" ? v.en : "", hi: typeof v?.hi === "string" ? v.hi : "" }))
    .filter((v) => v.en || v.hi);
  return items.length ? items : null;
}

function missedOf(value: unknown): Missed[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m) => typeof m?.day === "string" && (m?.slot === "morning" || m?.slot === "afternoon"))
    .map((m) => ({ day: m.day as string, slot: m.slot as Missed["slot"] }));
}

export function settingsOf(row: SettingsRow | null): ToiletSettings {
  const list = row ? checklistOf(row.checklist) : null;
  return {
    morningAt: normaliseTime(row?.morning_at) ?? DEFAULT_TIMES.morningAt,
    afternoonAt: normaliseTime(row?.afternoon_at) ?? DEFAULT_TIMES.afternoonAt,
    checklist: list ?? [...DEFAULT_CHECKLIST],
    defaults: !row,
  };
}

/** Everything the screen and Needs you need for the last `weeks` weeks. */
export async function readToilets(sessionLabel: string, today: string, weeks = LOOK_BACK_WEEKS, withNames = true): Promise<ToiletData> {
  const db = createAdminClient();
  const oldest = addDays(weekStartOf(today), -7 * (weeks - 1));
  const [toilets, settings, charts, calendar] = await Promise.all([
    db.from("toilets").select("id,name,place,used_by,position,created_at,removed_at,updated_at")
      .eq("session_label", sessionLabel)
      // A toilet removed before the oldest week shown has nothing left to say.
      .or(`removed_at.is.null,removed_at.gte.${oldest}T00:00:00+05:30`)
      .order("position").limit(200).returns<ToiletRow[]>(),
    db.from("toilet_settings").select("morning_at,afternoon_at,checklist").eq("session_label", sessionLabel).maybeSingle<SettingsRow>(),
    db.from("toilet_charts").select("id,toilet_id,week_start,pages,missed,note,uploaded_by,stored_at")
      .eq("session_label", sessionLabel).eq("upload_state", "stored").is("replaced_at", null).is("removed_at", null)
      .gte("week_start", oldest).limit(2000).returns<ChartRow[]>(),
    schoolCalendar(sessionLabel).catch(() => null),
  ]);
  if (missingTable(toilets.error) || missingTable(settings.error) || missingTable(charts.error)) return { ready: false };
  if (toilets.error || settings.error || charts.error) throw new Error("toilets_unreadable");

  const uploaders = [...new Set(charts.data.map((c) => c.uploaded_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (withNames && uploaders.length) {
    const { data } = await db.from("staff_profiles").select("id, display_name").in("id", uploaders.slice(0, 200)).returns<{ id: string; display_name: string | null }[]>();
    for (const row of data ?? []) if (row.display_name) names.set(row.id, row.display_name);
  }

  return {
    ready: true,
    toilets: toilets.data.map(toiletOf),
    settings: settingsOf(settings.data),
    charts: charts.data.map((c) => ({
      id: c.id,
      toiletId: c.toilet_id,
      weekStart: c.week_start,
      pages: c.pages.length,
      missed: missedOf(c.missed),
      note: c.note,
      uploadedBy: c.uploaded_by,
      uploadedByName: c.uploaded_by ? (names.get(c.uploaded_by) ?? null) : null,
      storedAt: c.stored_at,
    })),
    // No calendar read: Monday to Saturday open, as the register does without one.
    isOpen: (day: string) => (calendar ? isSchoolOpen(day, calendar) : new Date(`${day}T00:00:00Z`).getUTCDay() !== 0),
  };
}

/** One stored chart's pages, for the photo route. Null when it is not this session's or not stored. */
export async function chartPages(sessionLabel: string, chartId: string): Promise<{ pages: string[]; toiletId: string; weekStart: string } | null> {
  const { data, error } = await createAdminClient().from("toilet_charts")
    .select("pages, toilet_id, week_start, upload_state, removed_at")
    .eq("id", chartId).eq("session_label", sessionLabel).maybeSingle<{ pages: string[]; toilet_id: string; week_start: string; upload_state: string; removed_at: string | null }>();
  if (error || !data || data.upload_state !== "stored" || data.removed_at) return null;
  return { pages: data.pages, toiletId: data.toilet_id, weekStart: data.week_start };
}

/**
 * What Needs you says about toilet checks (D-652): how many charts are due
 * today, not uploaded, or came back with missed checks last week. Null when
 * the tables are not there yet or nothing is waiting.
 */
export async function toiletGaps(sessionLabel: string, today: string): Promise<{ late: number; dueToday: number; missed: number; oldestLate: string | null } | null> {
  const data = await readToilets(sessionLabel, today, LOOK_BACK_WEEKS, false);
  if (!data.ready) return null;
  const gaps = findGaps({ toilets: data.toilets, charts: data.charts, today, isOpen: data.isOpen });
  const counts = { late: gaps.late.length, dueToday: gaps.dueToday.length, missed: gaps.missedLastWeek.length };
  if (!counts.late && !counts.dueToday && !counts.missed) return null;
  const oldestLate = gaps.late.map((g) => g.weekStart).sort()[0] ?? null;
  return { ...counts, oldestLate };
}
