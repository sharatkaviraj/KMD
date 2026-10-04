import "server-only";

import { assertStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type {
  AbsenceInputValue,
  TeacherAbsence,
} from "@/modules/substitutions/domain/policies";
import type { AbsenceIndex } from "@/modules/substitutions/domain/engine";

type AbsenceRow = {
  id: string;
  staff_profile_id: string;
  day: string;
  periods: number[];
  reason: string | null;
  staff_profiles: { display_name: string; short_name: string } | null;
};

const COLUMNS =
  "id, staff_profile_id, day, periods, reason, " +
  "staff_profiles!inner(display_name, short_name)";

/**
 * Who is away on a day.
 *
 * Read through the service role because `reason` is no longer readable
 * directly (P1): why a colleague is away is between them and the person who
 * arranges cover, and before P1 every signed-in account — teachers included,
 * and the fee app's accounts too — could read it. The reason comes back only
 * to somebody who manages cover; everybody else gets who and when.
 */
export async function absencesOn(
  sessionLabel: string,
  day: string,
): Promise<TeacherAbsence[]> {
  const reader = await assertStaff();
  const showReason = can(reader, "substitutions:manage");

  const { data, error } = await createAdminClient()
    .from("teacher_absences")
    .select(COLUMNS)
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .returns<AbsenceRow[]>();

  if (error) throw new Error(`Could not read the absences: ${error.message}`);

  return data
    .map((row) => ({
      id: row.id,
      staffProfileId: row.staff_profile_id,
      staffName: row.staff_profiles?.display_name ?? "—",
      shortName: row.staff_profiles?.short_name ?? "—",
      day: row.day,
      periods: row.periods,
      reason: showReason ? row.reason : null,
    }))
    .sort((a, b) => a.staffName.localeCompare(b.staffName, "en"));
}

/** The engine's absence index, keyed by staff profile id. */
export function toAbsenceIndex(absences: TeacherAbsence[]): AbsenceIndex {
  const index: AbsenceIndex = {};
  for (const absence of absences) {
    if (absence.periods.length > 0) index[absence.staffProfileId] = absence.periods;
  }
  return index;
}

/**
 * Mark somebody away.
 *
 * An upsert on (staff, day): marking the same person twice is an edit to the
 * hours, not a second absence, and the unique index says so too.
 */
export async function markAbsent(
  input: AbsenceInputValue,
  sessionLabel: string,
  createdByUserId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("teacher_absences")
    .upsert(
      {
        session_label: sessionLabel,
        staff_profile_id: input.staffProfileId,
        day: input.day,
        periods: input.periods,
        reason: input.reason,
        created_by: createdByUserId,
      },
      { onConflict: "staff_profile_id,day" },
    );

  if (error) throw error;
}

/** They came in after all. */
export async function clearAbsence(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("teacher_absences")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

/** Everybody away on a day, for the dashboard count. */
export async function absenceCountOn(
  sessionLabel: string,
  day: string,
): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("teacher_absences")
    .select("id", { count: "exact", head: true })
    .eq("session_label", sessionLabel)
    .eq("day", day);

  if (error) throw new Error(`Could not count the absences: ${error.message}`);
  return count ?? 0;
}
