import "server-only";

import { getCurrentStaff } from "@/platform/auth/current-staff";
import { readsEveryClass, type StaffRole } from "@/platform/auth/permissions";
import { schoolToday } from "@/platform/dates";
import { CACHE_TAGS, sharedCache } from "@/platform/performance/shared-cache";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import {
  EVERY_CLASS,
  isEffectiveOn,
  ownClasses,
  type ClassScope,
} from "@/modules/attendance/domain/class-scope";

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
    heldClassIds(staffProfileId, sessionLabel),
    supabase
      .from("teaching_assignments")
      .select("class_id")
      .eq("staff_profile_id", staffProfileId)
      .eq("session_label", sessionLabel)
      .returns<{ class_id: string }[]>(),
  ]);

  if (taught.error) {
    throw new Error(`Could not read your classes: ${taught.error.message}`);
  }

  return [...new Set([...held, ...taught.data.map((row) => row.class_id)])];
}

/**
 * The classes this staff member is class teacher of, today.
 *
 * Today over the whole effective interval — see `isEffectiveOn` — which is
 * also what `vppsone.my_class_keys()` uses, so the page and the database
 * agree about whose class it is.
 */
export async function heldClassIds(
  staffProfileId: string,
  sessionLabel: string,
  day: string = schoolToday(),
): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_teachers")
    .select("class_id, effective_from, effective_to")
    .eq("staff_profile_id", staffProfileId)
    .eq("session_label", sessionLabel)
    .returns<{ class_id: string; effective_from: string | null; effective_to: string | null }[]>();

  if (error) throw new Error(`Could not read your classes: ${error.message}`);
  return [
    ...new Set(
      data
        .filter((row) =>
          isEffectiveOn({ effectiveFrom: row.effective_from, effectiveTo: row.effective_to }, day),
        )
        .map((row) => row.class_id),
    ),
  ];
}

/**
 * Which classes the signed-in member of staff may open the records of.
 *
 * Every page that shows a class's roll, register, notes or marks asks this
 * first, and refuses a class outside it rather than rendering it empty — an
 * empty roll reads as "nobody is enrolled", which is a different and wrong
 * answer (P1).
 */
export async function classScopeFor(
  staff: { id: string; role: StaffRole },
  sessionLabel: string,
): Promise<ClassScope> {
  if (readsEveryClass(staff)) return EVERY_CLASS;
  return ownClasses(await ownClassIds(staff.id, sessionLabel));
}

/**
 * Whose attendance this member of staff may read: the office and the
 * coordinators every class, a teacher only the class she holds as class
 * teacher. Narrower than `classScopeFor` on purpose — a subject teacher sees
 * the roll, notes and marks of a class she teaches, but its attendance is the
 * class teacher's (owner's decision, 6 Nov 2026).
 */
export async function attendanceScopeFor(
  staff: { id: string; role: StaffRole },
  sessionLabel: string,
): Promise<ClassScope> {
  if (readsEveryClass(staff)) return EVERY_CLASS;
  return ownClasses(await heldClassIds(staff.id, sessionLabel));
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
  // RLS let active staff read the slots and nobody else; kept, outside the cache.
  if (!(await getCurrentStaff())) return [];
  return cachedDayHeaders(versionId);
}

/**
 * A version's day headers, shared across requests (perf fix 4). Reading them
 * pages every slot of the version — about 2,000 rows, three sequential pages —
 * to learn at most six names, and teacher Today asked twice per load. A
 * version's slots are written once, when it is created, and never edited; a
 * republish is a new version id. So the answer for an id cannot change, and
 * the tag is only there so a publish clears the lot.
 */
const cachedDayHeaders = sharedCache(
  async (versionId: string): Promise<string[]> => {
    const admin = createAdminClient();
    const data = await fetchAllRows<{ day: string }>(
      (from, to) =>
        admin
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
  },
  ["vx-day-headers"],
  { tags: [CACHE_TAGS.timetable], revalidate: 3600 },
);
