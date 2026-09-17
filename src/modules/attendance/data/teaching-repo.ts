import "server-only";

import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";

/**
 * Which classes a staff member is responsible for.
 *
 * This is the row-level half of "own classes" that `attendance:mark` cannot
 * express on its own. Two sources, deliberately both:
 *
 *  - `class_teachers` — the class they hold, whether or not they teach it a
 *    period a day. The daily register is theirs.
 *  - `teaching_assignments` — every class they teach any subject to,
 *    regenerated from the published timetable on every publish.
 *
 * A teacher who holds a class but has no periods in it still marks its
 * register; one who teaches a class two periods a week still marks that
 * period's. Using only one source would lose one of them.
 */
export async function ownClassIds(
  staffProfileId: string,
  sessionLabel: string,
): Promise<string[]> {
  const supabase = await createClient();

  const [held, taught] = await Promise.all([
    supabase
      .from("class_teachers")
      .select("class_id")
      .eq("staff_profile_id", staffProfileId)
      .eq("session_label", sessionLabel)
      .is("effective_to", null)
      .returns<{ class_id: string }[]>(),
    supabase
      .from("teaching_assignments")
      .select("class_id")
      .eq("staff_profile_id", staffProfileId)
      .eq("session_label", sessionLabel)
      .returns<{ class_id: string }[]>(),
  ]);

  if (held.error) {
    throw new Error(`Could not read your classes: ${held.error.message}`);
  }
  if (taught.error) {
    throw new Error(`Could not read your classes: ${taught.error.message}`);
  }

  return [
    ...new Set([
      ...held.data.map((row) => row.class_id),
      ...taught.data.map((row) => row.class_id),
    ]),
  ];
}

/** The classes this staff member is class teacher of, today. */
export async function heldClassIds(
  staffProfileId: string,
  sessionLabel: string,
): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_teachers")
    .select("class_id")
    .eq("staff_profile_id", staffProfileId)
    .eq("session_label", sessionLabel)
    .is("effective_to", null)
    .returns<{ class_id: string }[]>();

  if (error) throw new Error(`Could not read your classes: ${error.message}`);
  return data.map((row) => row.class_id);
}

export type TodaySlot = {
  period: number;
  classId: string;
  classLabel: string;
  subjectCode: string;
  shared: boolean;
  parallel: boolean;
};

/**
 * This teacher's periods on a given weekday, from the published timetable.
 *
 * Empty when nothing is published — the Today card says so rather than
 * pretending the teacher has a free day.
 */
export async function periodsOn(
  staffProfileId: string,
  versionId: string,
  weekday: string,
): Promise<TodaySlot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_slots")
    .select("period, class_id, class_label, subject_code, shared, parallel")
    .eq("version_id", versionId)
    .eq("staff_profile_id", staffProfileId)
    .eq("day", weekday)
    .order("period")
    .returns<
      {
        period: number;
        class_id: string;
        class_label: string;
        subject_code: string;
        shared: boolean;
        parallel: boolean;
      }[]
    >();

  if (error) throw new Error(`Could not read your timetable: ${error.message}`);

  return data.map((row) => ({
    period: row.period,
    classId: row.class_id,
    classLabel: row.class_label,
    subjectCode: row.subject_code,
    shared: row.shared,
    parallel: row.parallel,
  }));
}

/**
 * The day headers this version actually uses.
 *
 * Read rather than assumed, because the sheet writes its own — see
 * `matchDayHeader()`.
 *
 * Paged like `listSlots()`: the table is over a thousand rows for a published
 * timetable, and although the first page happens to contain every distinct day
 * today, "happens to" is not a reason to read a truncated answer.
 */
export async function dayHeaders(versionId: string): Promise<string[]> {
  const supabase = await createClient();

  const data = await fetchAllRows<{ day: string }>(
    (from, to) =>
      supabase
        .from("timetable_slots")
        .select("day")
        .eq("version_id", versionId)
        .order("day")
        .order("period")
        .range(from, to)
        .returns<{ day: string }[]>(),
    "the timetable",
  );

  return [...new Set(data.map((row) => row.day))];
}
