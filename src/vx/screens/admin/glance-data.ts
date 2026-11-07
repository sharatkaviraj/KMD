import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { addDays } from "@/platform/dates";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { classLabelMap } from "@/modules/academics/data/academics-repo";
import { byClassLabel } from "@/modules/academics/domain/class-order";
import { birthdayDates, closedSpell, comingUp, type BirthdayChild, type CalendarRow, type EventRow, type TodayGlance } from "@/vx/screens/admin/today-logic";

/*
 * Today's small widgets (7 Nov 2026): the closed-day banner, "Coming up" and
 * "Birthdays today". Three short reads beside the rest of Today, none of them
 * money. The calendar is not sensitive and every member of staff sees it on
 * the Calendar screen; birthdays only for a reader who may see the children
 * (`students:view`), read with the service role as the teacher screens read
 * them (`teach/students.ts`), because the fee app's RLS keys on its own users.
 */

/** How far ahead the closed banner looks for the day school opens again. */
const CLOSED_LOOK_AHEAD = 40;
/** How far ahead "Coming up" looks. */
const COMING_WITHIN = 21;

async function calendarAhead(sessionLabel: string, today: string): Promise<CalendarRow[]> {
  const { data, error } = await createAdminClient()
    .from("academic_calendar_days")
    .select("day, kind, label_en, label_hi")
    .eq("session_label", sessionLabel)
    .gte("day", today)
    .lte("day", addDays(today, CLOSED_LOOK_AHEAD))
    .order("day")
    .returns<{ day: string; kind: CalendarRow["kind"]; label_en: string | null; label_hi: string | null }[]>();
  if (error) throw new Error(`Could not read the calendar: ${error.message}`);
  return data.map((row) => ({ day: row.day, kind: row.kind, en: row.label_en, hi: row.label_hi }));
}

async function eventsAhead(sessionLabel: string, today: string): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .select("title, title_hi, starts_on, ends_on")
    .eq("session_label", sessionLabel)
    .is("cancelled_at", null)
    .gte("ends_on", today)
    .lte("starts_on", addDays(today, COMING_WITHIN))
    .order("starts_on")
    .limit(20)
    .returns<{ title: string; title_hi: string | null; starts_on: string; ends_on: string }[]>();
  if (error) throw new Error(`Could not read the calendar events: ${error.message}`);
  return data.map((row) => ({ title: row.title, titleHi: row.title_hi, startsOn: row.starts_on, endsOn: row.ends_on }));
}

/**
 * Children enrolled this session whose birthday is today. The roll is asked
 * only for the two dozen dates of birth that can fall today, never read whole.
 */
async function birthdaysToday(sessionLabel: string, today: string): Promise<BirthdayChild[]> {
  const admin = createAdminClient();
  const { data: kids, error } = await admin
    .schema(FEE_SCHEMA)
    .from("students")
    .select("id, full_name")
    .in("date_of_birth", birthdayDates(today))
    .returns<{ id: string; full_name: string }[]>();
  if (error) throw new Error("Could not read the birthdays.");
  if (kids.length === 0) return [];
  const [{ data: rows, error: enrolError }, labels] = await Promise.all([
    fetchInChunks<{ student_id: string; class_id: string }>(kids.map((k) => k.id), IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin.from("enrolments").select("student_id, class_id").eq("session_label", sessionLabel).eq("status", "enrolled").in("student_id", chunk),
    ),
    classLabelMap(sessionLabel),
  ]);
  if (enrolError) throw new Error("Could not read the birthdays.");
  const classOf = new Map(rows.map((row) => [row.student_id, row.class_id]));
  return kids
    .filter((kid) => classOf.has(kid.id))
    .map((kid) => ({ id: kid.id, name: kid.full_name, classLabel: labels.get(classOf.get(kid.id)!) ?? null }))
    .sort((a, b) => {
      // Classes in school order ("2" before "10"); names as text within a class.
      const byClass = byClassLabel(a.classLabel ?? "", b.classLabel ?? "");
      return byClass !== 0 ? byClass : a.name.localeCompare(b.name);
    });
}

/** Each part fails on its own: a widget that could not be read is left out, never shown as nought. */
export async function loadGlance(staff: CurrentStaff, sessionLabel: string, today: string): Promise<TodayGlance> {
  const quiet = <T,>(read: Promise<T>) => read.catch((error: unknown) => {
    console.warn("[today] a glance read failed", error instanceof Error ? error.message : error);
    return null;
  });
  const [calendar, events, birthdays] = await Promise.all([
    quiet(calendarAhead(sessionLabel, today)),
    can(staff, "academics:view") ? quiet(eventsAhead(sessionLabel, today)) : Promise.resolve([] as EventRow[]),
    can(staff, "students:view") ? quiet(birthdaysToday(sessionLabel, today)) : Promise.resolve(null),
  ]);
  return {
    closed: calendar ? closedSpell(today, calendar, CLOSED_LOOK_AHEAD) : null,
    coming: calendar ? comingUp(today, calendar, events ?? [], COMING_WITHIN) : null,
    birthdays,
  };
}
