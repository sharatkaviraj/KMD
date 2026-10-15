import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { CACHE_TAGS, expireTag } from "@/platform/performance/shared-cache";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import {
  dayBefore,
  type AssignClassTeacherInput,
  type ClassTeacher,
  type ClassTeacherRole,
} from "@/modules/academics/domain/class-teachers";
import type {
  CalendarDay,
  CalendarDayInput,
  CalendarDayKind,
} from "@/modules/academics/domain/calendar";
import { expandRange } from "@/modules/academics/domain/calendar";

/* -------------------------------------------------------- class teachers */

type AssignmentRow = {
  id: string;
  class_id: string;
  session_label: string;
  staff_profile_id: string;
  role: ClassTeacherRole;
  effective_from: string;
  effective_to: string | null;
  replaced_reason: string | null;
  staff_profiles: { display_name: string; short_name: string } | null;
};

const ASSIGNMENT_COLUMNS =
  "id, class_id, session_label, staff_profile_id, role, effective_from, " +
  "effective_to, replaced_reason, staff_profiles(display_name, short_name)";

function toAssignment(row: AssignmentRow): ClassTeacher {
  return {
    id: row.id,
    classId: row.class_id,
    sessionLabel: row.session_label,
    staffProfileId: row.staff_profile_id,
    // The join is inside `vppsone`, so it is an ordinary PostgREST embed.
    staffDisplayName: row.staff_profiles?.display_name ?? "—",
    staffShortName: row.staff_profiles?.short_name ?? "—",
    role: row.role,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    replacedReason: row.replaced_reason,
  };
}

/** Every assignment for a session, current and closed. */
export async function listClassTeachers(
  sessionLabel: string,
): Promise<ClassTeacher[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_teachers")
    .select(ASSIGNMENT_COLUMNS)
    .eq("session_label", sessionLabel)
    .order("effective_from", { ascending: false })
    .returns<AssignmentRow[]>();

  if (error) {
    throw new Error(`Could not read the class teachers: ${error.message}`);
  }

  return data.map(toAssignment);
}

export async function getCurrentClassTeacher(
  classId: string,
  sessionLabel: string,
  role: ClassTeacherRole,
): Promise<ClassTeacher | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_teachers")
    .select(ASSIGNMENT_COLUMNS)
    .eq("class_id", classId)
    .eq("session_label", sessionLabel)
    .eq("role", role)
    .is("effective_to", null)
    .maybeSingle<AssignmentRow>();

  if (error) {
    throw new Error(`Could not read that class teacher: ${error.message}`);
  }

  return data ? toAssignment(data) : null;
}

/**
 * Hand a class to somebody new.
 *
 * Two writes, in this order: close the outgoing row on the day before the new
 * one starts, then open the new one. The order matters — the partial unique
 * index allows exactly one open row per class and role, so opening first would
 * be refused. Closing first means a failure between the two leaves a class
 * with nobody, which is visible on the screen and fixable; the other order
 * would leave the insert permanently blocked by a row nobody can see is stale.
 */
export async function assignClassTeacher(
  input: AssignClassTeacherInput,
  sessionLabel: string,
  createdByUserId: string,
): Promise<void> {
  const admin = createAdminClient();

  const current = await getCurrentClassTeacher(
    input.classId,
    sessionLabel,
    input.role,
  );

  if (current) {
    const { error } = await admin
      .from("class_teachers")
      .update({
        effective_to: dayBefore(input.effectiveFrom),
        replaced_reason: input.replacedReason,
      })
      .eq("id", current.id);

    if (error) throw error;
  }

  const { error } = await admin.from("class_teachers").insert({
    class_id: input.classId,
    session_label: sessionLabel,
    staff_profile_id: input.staffProfileId,
    role: input.role,
    effective_from: input.effectiveFrom,
    created_by: createdByUserId,
  });

  if (error) throw error;
}

/**
 * End a term without naming a successor — a teacher leaving mid-year.
 *
 * Deliberately not a delete: the history is the point.
 */
export async function endClassTeacherTerm(
  assignmentId: string,
  lastDay: string,
  reason: string | null,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("class_teachers")
    .update({ effective_to: lastDay, replaced_reason: reason })
    .eq("id", assignmentId);

  if (error) throw error;
}

/* ------------------------------------------------------------- calendar */

type CalendarRow = {
  id: string;
  session_label: string;
  day: string;
  kind: CalendarDayKind;
  label_hi: string | null;
  label_en: string | null;
};

export async function listCalendarDays(
  sessionLabel: string,
): Promise<CalendarDay[]> {
  await assertPermission("academics:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academic_calendar_days")
    .select("id, session_label, day, kind, label_hi, label_en")
    .eq("session_label", sessionLabel)
    .order("day")
    .returns<CalendarRow[]>();

  if (error) {
    throw new Error(`Could not read the calendar: ${error.message}`);
  }

  return data.map((row) => ({
    id: row.id,
    sessionLabel: row.session_label,
    day: row.day,
    kind: row.kind,
    labelHi: row.label_hi,
    labelEn: row.label_en,
  }));
}

/**
 * Write one day, or every day in a range.
 *
 * An upsert on `(session_label, day)`: marking a week as vacation when two of
 * its days are already holidays should leave a week of vacation, not fail
 * halfway. A day is one thing, and the last thing said about it wins.
 */
export async function upsertCalendarDays(
  input: CalendarDayInput,
  sessionLabel: string,
  createdByUserId: string,
): Promise<number> {
  const days = expandRange(input.day, input.until);

  const { error } = await createAdminClient()
    .from("academic_calendar_days")
    .upsert(
      days.map((day) => ({
        session_label: sessionLabel,
        day,
        kind: input.kind,
        label_hi: input.labelHi,
        label_en: input.labelEn,
        created_by: createdByUserId,
      })),
      { onConflict: "session_label,day" },
    );

  if (error) throw error;
  expireTag(CACHE_TAGS.calendar);

  return days.length;
}

/**
 * Remove a day, returning it to the weekly pattern.
 *
 * Safe to delete, unlike a class-teacher term: the calendar records what the
 * school decided, and undeciding it is a real thing to want. Nothing records
 * history against a calendar row.
 */
export async function deleteCalendarDay(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("academic_calendar_days")
    .delete()
    .eq("id", id);

  if (error) throw error;
  expireTag(CACHE_TAGS.calendar);
}
