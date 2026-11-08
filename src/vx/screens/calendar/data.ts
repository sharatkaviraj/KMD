import "server-only";

import { cache } from "react";

import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { createAdminClient } from "@/platform/supabase/admin";
import { WHATSAPP_MESSAGE_COST_RUPEES } from "@/modules/whatsapp/domain/run-measurement";
import { studentInfo, staffDirectory } from "@/vx/screens/academics/data";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

import type { CalEvent, CalHoliday, NoticeCounts } from "./domain";

/*
 * Server reads for the school calendar. Events live in
 * `vppsone.calendar_events`; holidays and vacations are
 * `vppsone.academic_calendar_days`, which attendance and the timetable read.
 */

type EventRow = {
  id: string;
  kind: string;
  title: string;
  title_hi: string | null;
  starts_on: string;
  ends_on: string;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  place: string | null;
  class_ids: string[];
  details: string | null;
  created_by: string | null;
  created_at: string;
  cancelled_at: string | null;
};

const EVENT_COLUMNS = "id, kind, title, title_hi, starts_on, ends_on, all_day, starts_at, ends_at, place, class_ids, details, created_by, created_at, cancelled_at";

function toEvent(row: EventRow): CalEvent {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    titleHi: row.title_hi,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    allDay: row.all_day,
    startsAt: row.starts_at ? row.starts_at.slice(0, 5) : null,
    endsAt: row.ends_at ? row.ends_at.slice(0, 5) : null,
    place: row.place,
    classIds: row.class_ids ?? [],
    details: row.details,
    createdBy: row.created_by,
    cancelled: !!row.cancelled_at,
  };
}

export async function eventsBetween(session: string, from: string, to: string): Promise<CalEvent[]> {
  const { data, error } = await createAdminClient()
    .from("calendar_events")
    .select(EVENT_COLUMNS)
    .eq("session_label", session)
    .is("cancelled_at", null)
    .lte("starts_on", to)
    .gte("ends_on", from)
    .order("starts_on")
    .order("starts_at", { ascending: true, nullsFirst: true })
    .returns<EventRow[]>();
  if (error) throw new Error(`Could not read the calendar: ${error.message}`);
  return data.map(toEvent);
}

export async function eventById(session: string, id: string): Promise<CalEvent | null> {
  const { data } = await createAdminClient().from("calendar_events").select(EVENT_COLUMNS).eq("session_label", session).eq("id", id).maybeSingle<EventRow>();
  return data ? toEvent(data) : null;
}

export async function holidaysBetween(session: string, from: string, to: string): Promise<CalHoliday[]> {
  const { data, error } = await createAdminClient()
    .from("academic_calendar_days")
    .select("id, day, kind, label_en, label_hi")
    .eq("session_label", session)
    .gte("day", from)
    .lte("day", to)
    .neq("kind", "instructional")
    .order("day")
    .returns<{ id: string; day: string; kind: string; label_en: string | null; label_hi: string | null }[]>();
  if (error) throw new Error(`Could not read the holidays: ${error.message}`);
  return data.map((row) => ({ id: row.id, day: row.day, kind: row.kind, label: row.label_en, labelHi: row.label_hi }));
}

export type Notice = { id: string; eventId: string | null; holidayDay: string | null; audience: string; recipients: number; costPaise: number; status: string; requestedAt: string; by: string; textHi: string; textEn: string; campaignId: string | null; decidedAt: string | null };

export async function noticesFor(session: string, filter: { eventId?: string; holidayDays?: string[] }): Promise<Notice[]> {
  let q = createAdminClient()
    .from("calendar_notices")
    .select("id, event_id, holiday_day, audience, recipients, cost_paise, status, requested_at, requested_by, rendered_hi, rendered_en, campaign_id, decided_at")
    .eq("session_label", session)
    .order("requested_at", { ascending: false });
  if (filter.eventId) q = q.eq("event_id", filter.eventId);
  if (filter.holidayDays) q = q.in("holiday_day", filter.holidayDays.length ? filter.holidayDays : ["1900-01-01"]);
  const { data } = await q.returns<{ id: string; event_id: string | null; holiday_day: string | null; audience: string; recipients: number; cost_paise: number; status: string; requested_at: string; requested_by: string; rendered_hi: string; rendered_en: string; campaign_id: string | null; decided_at: string | null }[]>();
  const staff = await staffDirectory();
  return (data ?? []).map((n) => ({ id: n.id, eventId: n.event_id, holidayDay: n.holiday_day, audience: n.audience, recipients: n.recipients, costPaise: n.cost_paise, status: n.status, requestedAt: n.requested_at, by: staff.get(n.requested_by)?.display_name ?? "—", textHi: n.rendered_hi, textEn: n.rendered_en, campaignId: n.campaign_id, decidedAt: n.decided_at }));
}

const enrolledFor = cache(async (session: string) =>
  fetchAllRows<{ student_id: string; class_id: string }>(
    (a, b) => createAdminClient().from("enrolments").select("student_id, class_id").eq("session_label", session).eq("status", "enrolled").order("id").range(a, b),
    "the roll",
  ),
);

/** How many parents a notice to these classes reaches (empty = whole school), and the staff count. */
export async function audienceSize(session: string, classIds: string[]): Promise<{ parents: number; staff: number }> {
  const [roll, staff] = await Promise.all([enrolledFor(session), staffDirectory()]);
  const wanted = new Set(classIds);
  const parents = roll.filter((r) => wanted.size === 0 || wanted.has(r.class_id)).length;
  return { parents, staff: [...staff.values()].filter((s) => s.is_active && staffBelongsToSession(s.is_test_account, session)).length };
}

/** About what a WhatsApp notice costs, in paise. */
export function costPaise(recipients: number): number {
  return Math.round(recipients * WHATSAPP_MESSAGE_COST_RUPEES * 100);
}

/** Children's birthdays, by "MM-DD", for the children on the roll. */
export const birthdays = cache(async (session: string): Promise<Map<string, { studentId: string; name: string; classId: string }[]>> => {
  const roll = await enrolledFor(session);
  const info = await studentInfo(roll.map((r) => r.student_id));
  const out = new Map<string, { studentId: string; name: string; classId: string }[]>();
  for (const r of roll) {
    const i = info.get(r.student_id);
    if (!i?.dob) continue;
    const key = i.dob.slice(5, 10);
    const list = out.get(key) ?? [];
    list.push({ studentId: r.student_id, name: i.name, classId: r.class_id });
    out.set(key, list);
  }
  return out;
});

/** Teachers away on a day, by name. */
export async function staffAway(session: string, from: string, to: string): Promise<Map<string, string[]>> {
  const { data } = await createAdminClient()
    .from("teacher_absences")
    .select("day, staff_profile_id")
    .eq("session_label", session)
    .gte("day", from)
    .lte("day", to)
    .returns<{ day: string; staff_profile_id: string }[]>();
  const staff = await staffDirectory();
  const out = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = out.get(row.day) ?? [];
    list.push(staff.get(row.staff_profile_id)?.display_name ?? "—");
    out.set(row.day, list);
  }
  return out;
}

/** Children on the roll, by class. */
export async function rollByClass(session: string): Promise<Map<string, number>> {
  const roll = await enrolledFor(session);
  const out = new Map<string, number>();
  for (const r of roll) out.set(r.class_id, (out.get(r.class_id) ?? 0) + 1);
  return out;
}

/** Staff away by day, with the periods and the reason the cover day recorded. */
export async function staffAwayDetail(session: string, from: string, to: string): Promise<Map<string, { name: string; reason: string | null; periods: number[] }[]>> {
  const { data } = await createAdminClient()
    .from("teacher_absences")
    .select("day, staff_profile_id, periods, reason")
    .eq("session_label", session)
    .gte("day", from)
    .lte("day", to)
    .returns<{ day: string; staff_profile_id: string; periods: number[] | null; reason: string | null }[]>();
  const staff = await staffDirectory();
  const out = new Map<string, { name: string; reason: string | null; periods: number[] }[]>();
  for (const row of data ?? []) {
    const list = out.get(row.day) ?? [];
    list.push({ name: staff.get(row.staff_profile_id)?.display_name ?? "—", reason: row.reason, periods: row.periods ?? [] });
    out.set(row.day, list);
  }
  return out;
}

/**
 * What became of an approved notice's messages, by campaign: the per-family
 * rows in `message_sends` that a person sends by hand from Messages → To
 * send (UI-71). Sent, still waiting, or not sent (failed or cancelled).
 */
export async function noticeCounts(campaignIds: string[]): Promise<Record<string, NoticeCounts>> {
  const ids = [...new Set(campaignIds)];
  if (ids.length === 0) return {};
  const data: { campaign_id: string; status: string }[] = [];
  try {
    // A notice to the whole school is one row per family, so every chunk is paged.
    for (const chunk of chunkArray(ids, IN_FILTER_CHUNK_SIZE)) {
      data.push(
        ...(await fetchAllRows<{ campaign_id: string; status: string }>(
          (from, to) => createAdminClient().from("message_sends").select("campaign_id, status").in("campaign_id", chunk).order("id").range(from, to),
          "the notice messages",
        )),
      );
    }
  } catch {
    return {};
  }
  const out: Record<string, NoticeCounts> = {};
  for (const row of data) {
    const c = (out[row.campaign_id] ??= { total: 0, sent: 0, waiting: 0, notSent: 0 });
    c.total += 1;
    if (row.status === "sent") c.sent += 1;
    else if (row.status === "queued" || row.status === "draft") c.waiting += 1;
    else c.notSent += 1;
  }
  return out;
}
