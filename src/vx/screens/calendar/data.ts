import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/platform/supabase/admin";
import { WHATSAPP_MESSAGE_COST_RUPEES } from "@/modules/whatsapp/domain/run-measurement";
import { studentInfo, staffDirectory } from "@/vx/screens/academics/data";
import { fetchAllRows } from "@/platform/supabase/paginate";

import type { CalEvent, CalHoliday } from "./domain";

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

export type Notice = { id: string; eventId: string | null; holidayDay: string | null; audience: string; recipients: number; costPaise: number; status: string; requestedAt: string; by: string; textHi: string; textEn: string };

export async function noticesFor(session: string, filter: { eventId?: string; holidayDays?: string[] }): Promise<Notice[]> {
  let q = createAdminClient()
    .from("calendar_notices")
    .select("id, event_id, holiday_day, audience, recipients, cost_paise, status, requested_at, requested_by, rendered_hi, rendered_en")
    .eq("session_label", session)
    .order("requested_at", { ascending: false });
  if (filter.eventId) q = q.eq("event_id", filter.eventId);
  if (filter.holidayDays) q = q.in("holiday_day", filter.holidayDays.length ? filter.holidayDays : ["1900-01-01"]);
  const { data } = await q.returns<{ id: string; event_id: string | null; holiday_day: string | null; audience: string; recipients: number; cost_paise: number; status: string; requested_at: string; requested_by: string; rendered_hi: string; rendered_en: string }[]>();
  const staff = await staffDirectory();
  return (data ?? []).map((n) => ({ id: n.id, eventId: n.event_id, holidayDay: n.holiday_day, audience: n.audience, recipients: n.recipients, costPaise: n.cost_paise, status: n.status, requestedAt: n.requested_at, by: staff.get(n.requested_by)?.display_name ?? "—", textHi: n.rendered_hi, textEn: n.rendered_en }));
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
  return { parents, staff: [...staff.values()].filter((s) => s.is_active).length };
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
