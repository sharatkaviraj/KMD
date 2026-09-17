import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type { MatchTier } from "@/modules/substitutions/domain/engine";

/**
 * Cover plans and what is in them.
 *
 * A plan is one day. It records the timetable version it was planned against,
 * because a plan built on a timetable that has since been republished is
 * describing periods that may no longer exist — see `planIsStale()`.
 */

export type PlanKind = "cover" | "self_study" | "merged";
export type PlanSource = "auto" | "suggestion" | "manual";
export type PlanStatus = "draft" | "published";

export type SubstitutionPlan = {
  id: string;
  sessionLabel: string;
  day: string;
  versionId: string;
  status: PlanStatus;
  generatedAt: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
};

export type PlanAssignment = {
  id: string;
  planId: string;
  period: number;
  classId: string;
  classLabel: string;
  subjectCode: string | null;
  originalStaffId: string | null;
  originalStaffName: string | null;
  coveringStaffId: string | null;
  coveringStaffName: string | null;
  kind: PlanKind;
  mergeHostClassId: string | null;
  mergeHostClassLabel: string | null;
  matchTier: MatchTier | null;
  source: PlanSource;
  warnings: string[];
  pinned: boolean;
};

type PlanRow = {
  id: string;
  session_label: string;
  day: string;
  version_id: string;
  status: PlanStatus;
  generated_at: string | null;
  published_at: string | null;
  staff_profiles: { display_name: string } | null;
};

const PLAN_COLUMNS =
  "id, session_label, day, version_id, status, generated_at, published_at, " +
  "staff_profiles(display_name)";

const toPlan = (row: PlanRow): SubstitutionPlan => ({
  id: row.id,
  sessionLabel: row.session_label,
  day: row.day,
  versionId: row.version_id,
  status: row.status,
  generatedAt: row.generated_at,
  publishedAt: row.published_at,
  publishedByName: row.staff_profiles?.display_name ?? null,
});

export async function getPlan(
  sessionLabel: string,
  day: string,
): Promise<SubstitutionPlan | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("substitution_plans")
    .select(PLAN_COLUMNS)
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .maybeSingle<PlanRow>();

  if (error) throw new Error(`Could not read the plan: ${error.message}`);
  return data ? toPlan(data) : null;
}

type AssignmentRow = {
  id: string;
  plan_id: string;
  period: number;
  class_id: string;
  class_label: string;
  subject_code: string | null;
  original_staff_id: string | null;
  covering_staff_id: string | null;
  kind: PlanKind;
  merge_host_class_id: string | null;
  merge_host_class_label: string | null;
  match_tier: MatchTier | null;
  source: PlanSource;
  warnings: string[];
  pinned: boolean;
  original: { display_name: string } | null;
  covering: { display_name: string } | null;
};

const ASSIGNMENT_COLUMNS =
  "id, plan_id, period, class_id, class_label, subject_code, original_staff_id, " +
  "covering_staff_id, kind, merge_host_class_id, merge_host_class_label, match_tier, " +
  "source, warnings, pinned, " +
  "original:staff_profiles!substitution_assignments_original_staff_id_fkey(display_name), " +
  "covering:staff_profiles!substitution_assignments_covering_staff_id_fkey(display_name)";

const toAssignment = (row: AssignmentRow): PlanAssignment => ({
  id: row.id,
  planId: row.plan_id,
  period: row.period,
  classId: row.class_id,
  classLabel: row.class_label,
  subjectCode: row.subject_code,
  originalStaffId: row.original_staff_id,
  originalStaffName: row.original?.display_name ?? null,
  coveringStaffId: row.covering_staff_id,
  coveringStaffName: row.covering?.display_name ?? null,
  kind: row.kind,
  mergeHostClassId: row.merge_host_class_id,
  mergeHostClassLabel: row.merge_host_class_label,
  matchTier: row.match_tier,
  source: row.source,
  warnings: row.warnings ?? [],
  pinned: row.pinned,
});

export async function planAssignments(planId: string): Promise<PlanAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("substitution_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("plan_id", planId)
    .order("period")
    .returns<AssignmentRow[]>();

  if (error) throw new Error(`Could not read the plan: ${error.message}`);
  return data.map(toAssignment);
}

export async function ensurePlan(input: {
  sessionLabel: string;
  day: string;
  versionId: string;
  createdByUserId: string;
}): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("substitution_plans")
    .upsert(
      {
        session_label: input.sessionLabel,
        day: input.day,
        version_id: input.versionId,
        created_by: input.createdByUserId,
      },
      { onConflict: "session_label,day" },
    )
    .select("id")
    .single<{ id: string }>();

  if (error) throw error;
  return data.id;
}

export type AssignmentWrite = {
  period: number;
  classId: string;
  classLabel: string;
  subjectCode: string | null;
  originalStaffId: string | null;
  coveringStaffId: string | null;
  kind: PlanKind;
  mergeHostClassId?: string | null;
  mergeHostClassLabel?: string | null;
  matchTier?: string | null;
  source: PlanSource;
  warnings?: string[];
  pinned?: boolean;
};

/**
 * Replace a plan's rows with a freshly generated allocation.
 *
 * **Pins survive.** A pin is a decision somebody made on purpose — the whole
 * reason to regenerate is that something changed *around* their decision, not
 * that they want it undone. So the pinned rows are read first, everything else
 * is cleared, and the new allocation is written for the periods a pin does not
 * already own.
 *
 * The version stamp is refreshed at the same time, so a plan that was stale
 * stops being stale once it has been regenerated against the live timetable.
 */
export async function replaceGenerated(
  planId: string,
  versionId: string,
  rows: AssignmentWrite[],
): Promise<{ written: number; keptPins: number }> {
  const admin = createAdminClient();

  const { data: pins, error: pinError } = await admin
    .from("substitution_assignments")
    .select("class_id, period")
    .eq("plan_id", planId)
    .eq("pinned", true)
    .returns<{ class_id: string; period: number }[]>();

  if (pinError) throw pinError;

  const pinned = new Set((pins ?? []).map((pin) => `${pin.class_id}|${pin.period}`));

  const { error: clearError } = await admin
    .from("substitution_assignments")
    .delete()
    .eq("plan_id", planId)
    .eq("pinned", false);

  if (clearError) throw clearError;

  const fresh = rows.filter((row) => !pinned.has(`${row.classId}|${row.period}`));

  if (fresh.length > 0) {
    const { error } = await admin.from("substitution_assignments").insert(
      fresh.map((row) => ({
        plan_id: planId,
        period: row.period,
        class_id: row.classId,
        class_label: row.classLabel,
        subject_code: row.subjectCode,
        original_staff_id: row.originalStaffId,
        covering_staff_id: row.coveringStaffId,
        kind: row.kind,
        merge_host_class_id: row.mergeHostClassId ?? null,
        merge_host_class_label: row.mergeHostClassLabel ?? null,
        match_tier: row.matchTier ?? null,
        source: row.source,
        warnings: row.warnings ?? [],
        pinned: row.pinned ?? false,
      })),
    );

    if (error) throw error;
  }

  const { error: stampError } = await admin
    .from("substitution_plans")
    .update({ version_id: versionId, generated_at: new Date().toISOString() })
    .eq("id", planId);

  if (stampError) throw stampError;

  return { written: fresh.length, keptPins: pinned.size };
}

/** One row, changed by hand. Upserted on the slot it belongs to. */
export async function setAssignment(
  planId: string,
  row: AssignmentWrite,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("substitution_assignments")
    .upsert(
      {
        plan_id: planId,
        period: row.period,
        class_id: row.classId,
        class_label: row.classLabel,
        subject_code: row.subjectCode,
        original_staff_id: row.originalStaffId,
        covering_staff_id: row.coveringStaffId,
        kind: row.kind,
        merge_host_class_id: row.mergeHostClassId ?? null,
        merge_host_class_label: row.mergeHostClassLabel ?? null,
        match_tier: row.matchTier ?? null,
        source: row.source,
        warnings: row.warnings ?? [],
        pinned: row.pinned ?? true,
      },
      { onConflict: "plan_id,class_id,period" },
    );

  if (error) throw error;
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await createAdminClient()
    .from("substitution_assignments")
    .update({ pinned })
    .eq("id", id);

  if (error) throw error;
}

export async function removeAssignment(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("substitution_assignments")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

/**
 * Publish.
 *
 * A published plan is what the covering teachers see on their own Today card,
 * which is the whole point of the screen: a cover nobody was told about is a
 * class nobody turns up to.
 */
export async function publishPlan(
  planId: string,
  publishedByStaffId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("substitution_plans")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: publishedByStaffId,
    })
    .eq("id", planId);

  if (error) throw error;
}

/** Back to a draft — nothing is shown to teachers while a plan is being redone. */
export async function unpublishPlan(planId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("substitution_plans")
    .update({ status: "draft", published_at: null, published_by: null })
    .eq("id", planId);

  if (error) throw error;
}

/**
 * The covers one teacher has been given today, from a **published** plan only.
 *
 * A draft is somebody's work in progress: showing it on a teacher's Today card
 * would have them turn up to a class the coordinator has not finished deciding
 * about.
 */
export async function coversForTeacher(
  staffProfileId: string,
  sessionLabel: string,
  day: string,
): Promise<PlanAssignment[]> {
  await assertPermission("attendance:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("substitution_assignments")
    .select(
      `${ASSIGNMENT_COLUMNS}, substitution_plans!inner(day, session_label, status)`,
    )
    .eq("covering_staff_id", staffProfileId)
    .eq("substitution_plans.session_label", sessionLabel)
    .eq("substitution_plans.day", day)
    .eq("substitution_plans.status", "published")
    .order("period")
    .returns<AssignmentRow[]>();

  if (error) throw new Error(`Could not read your cover duties: ${error.message}`);
  return data.map(toAssignment);
}

/**
 * Every class in a published plan for a day, whoever is covering.
 *
 * What the office pins on the noticeboard, and what a class teacher checks
 * when a stranger walks into their room.
 */
export async function publishedPlanFor(
  sessionLabel: string,
  day: string,
): Promise<{ plan: SubstitutionPlan; rows: PlanAssignment[] } | null> {
  const plan = await getPlan(sessionLabel, day);
  if (!plan || plan.status !== "published") return null;
  return { plan, rows: await planAssignments(plan.id) };
}

/**
 * How often each teacher has covered lately.
 *
 * Feeds the engine's history penalty. Draft plans count: a coordinator who has
 * already planned tomorrow should not be told today that the same person is
 * rested.
 */
export async function recentCovers(
  sessionLabel: string,
  from: string,
  to: string,
): Promise<{ coveringStaffId: string | null }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("substitution_assignments")
    .select("covering_staff_id, substitution_plans!inner(day, session_label)")
    .eq("substitution_plans.session_label", sessionLabel)
    .gte("substitution_plans.day", from)
    .lte("substitution_plans.day", to)
    .returns<{ covering_staff_id: string | null }[]>();

  if (error) throw new Error(`Could not read the cover history: ${error.message}`);
  return data.map((row) => ({ coveringStaffId: row.covering_staff_id }));
}
