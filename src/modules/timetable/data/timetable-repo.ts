import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import type { StoredSlot } from "@/modules/timetable/domain/views";
import type { ResolvedSlot } from "@/modules/timetable/domain/resolve-import";
import { buildAssignments } from "@/modules/timetable/domain/views";

export type TimetableStatus = "draft" | "published" | "archived";

export type TimetableVersion = {
  id: string;
  sessionLabel: string;
  label: string;
  status: TimetableStatus;
  notes: string | null;
  cellCount: number;
  slotCount: number;
  publishedAt: string | null;
  createdAt: string;
};

const VERSION_COLUMNS =
  "id, session_label, label, status, notes, cell_count, slot_count, published_at, created_at";

type VersionRow = {
  id: string;
  session_label: string;
  label: string;
  status: TimetableStatus;
  notes: string | null;
  cell_count: number;
  slot_count: number;
  published_at: string | null;
  created_at: string;
};

const toVersion = (row: VersionRow): TimetableVersion => ({
  id: row.id,
  sessionLabel: row.session_label,
  label: row.label,
  status: row.status,
  notes: row.notes,
  cellCount: row.cell_count,
  slotCount: row.slot_count,
  publishedAt: row.published_at,
  createdAt: row.created_at,
});

export async function listVersions(
  sessionLabel: string,
): Promise<TimetableVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_versions")
    .select(VERSION_COLUMNS)
    .eq("session_label", sessionLabel)
    .order("created_at", { ascending: false })
    .returns<VersionRow[]>();

  if (error) throw new Error(`Could not read the timetable versions: ${error.message}`);
  return data.map(toVersion);
}

export async function getVersion(id: string): Promise<TimetableVersion | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_versions")
    .select(VERSION_COLUMNS)
    .eq("id", id)
    .maybeSingle<VersionRow>();

  if (error) throw new Error(`Could not read that version: ${error.message}`);
  return data ? toVersion(data) : null;
}

export async function getPublishedVersion(
  sessionLabel: string,
): Promise<TimetableVersion | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_versions")
    .select(VERSION_COLUMNS)
    .eq("session_label", sessionLabel)
    .eq("status", "published")
    .maybeSingle<VersionRow>();

  if (error) throw new Error(`Could not read the published timetable: ${error.message}`);
  return data ? toVersion(data) : null;
}

export async function getVersionSource(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_versions")
    .select("source_text")
    .eq("id", id)
    .maybeSingle<{ source_text: string | null }>();

  if (error) throw new Error(`Could not read that sheet: ${error.message}`);
  return data?.source_text ?? null;
}

type SlotRow = {
  day: string;
  period: number;
  class_id: string;
  class_label: string;
  subject_id: string;
  subject_code: string;
  staff_profile_id: string;
  teacher_short_name: string;
  parallel: boolean;
  shared: boolean;
};

/**
 * Every slot in a version.
 *
 * Paged, because a published timetable is over a thousand rows — 768 cells
 * expand to 1038 slots once a shared block and a parallel elective each become
 * one slot per teacher — and PostgREST answers the first thousand with no
 * error and no warning. See `paginate.ts`; this is the read that found it.
 */
export async function listSlots(versionId: string): Promise<StoredSlot[]> {
  const supabase = await createClient();

  const data = await fetchAllRows<SlotRow>(
    (from, to) =>
      supabase
        .from("timetable_slots")
        .select(
          "day, period, class_id, class_label, subject_id, subject_code, staff_profile_id, teacher_short_name, parallel, shared",
        )
        .eq("version_id", versionId)
        // A stable order, so a row cannot be skipped between pages.
        .order("day")
        .order("period")
        .order("class_label")
        .order("teacher_short_name")
        .range(from, to)
        .returns<SlotRow[]>(),
    "the timetable",
  );

  return data.map((row) => ({
    day: row.day,
    period: row.period,
    classId: row.class_id,
    classLabel: row.class_label,
    subjectId: row.subject_id,
    subjectCode: row.subject_code,
    staffProfileId: row.staff_profile_id,
    teacherShortName: row.teacher_short_name,
    parallel: row.parallel,
    shared: row.shared,
  }));
}

/**
 * Create a draft from a resolved import.
 *
 * Always a draft, never published: a sheet becomes the school's timetable
 * only when somebody presses publish, having looked at it.
 */
export async function createDraft(input: {
  sessionLabel: string;
  label: string;
  notes: string | null;
  sourceText: string;
  cellCount: number;
  slots: ResolvedSlot[];
  createdByUserId: string;
}): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("timetable_versions")
    .insert({
      session_label: input.sessionLabel,
      label: input.label,
      status: "draft",
      source_text: input.sourceText,
      notes: input.notes,
      cell_count: input.cellCount,
      slot_count: input.slots.length,
      created_by: input.createdByUserId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw error;

  const versionId = data.id;
  const BATCH = 500;

  for (let index = 0; index < input.slots.length; index += BATCH) {
    const { error: slotError } = await admin.from("timetable_slots").insert(
      input.slots.slice(index, index + BATCH).map((slot) => ({
        version_id: versionId,
        day: slot.day,
        period: slot.period,
        class_id: slot.classId,
        class_label: slot.classLabel,
        subject_id: slot.subjectId,
        subject_code: slot.subjectCode,
        staff_profile_id: slot.staffProfileId,
        teacher_short_name: slot.teacherShortName,
        parallel: slot.parallel,
        shared: slot.shared,
      })),
    );

    if (slotError) throw slotError;
  }

  return versionId;
}

/**
 * Publish a draft.
 *
 * Three writes in a deliberate order:
 *
 *  1. archive whatever is currently published, because the partial unique
 *     index allows exactly one published version per session and publishing
 *     first would be refused;
 *  2. publish this one;
 *  3. regenerate `teaching_assignments` from its slots (PLAN §4 — regenerated,
 *     never edited).
 *
 * Step 3 last, so an interruption leaves a published timetable with stale
 * assignments — visible and fixable by publishing again — rather than
 * assignments for a timetable that is not live.
 */
export async function publishVersion(
  versionId: string,
  sessionLabel: string,
  publishedByUserId: string,
): Promise<{ assignments: number }> {
  const admin = createAdminClient();

  const { error: archiveError } = await admin
    .from("timetable_versions")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("session_label", sessionLabel)
    .eq("status", "published");

  if (archiveError) throw archiveError;

  const { error: publishError } = await admin
    .from("timetable_versions")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: publishedByUserId,
    })
    .eq("id", versionId);

  if (publishError) throw publishError;

  const slots = await listSlots(versionId);
  const assignments = buildAssignments(slots);

  // Replaced wholesale rather than merged: an assignment that no longer
  // exists in the new timetable must disappear, and a diff would be a second
  // place the rule lives.
  const { error: clearError } = await admin
    .from("teaching_assignments")
    .delete()
    .eq("session_label", sessionLabel);

  if (clearError) throw clearError;

  if (assignments.length > 0) {
    const { error: insertError } = await admin.from("teaching_assignments").insert(
      assignments.map((assignment) => ({
        session_label: sessionLabel,
        staff_profile_id: assignment.staffProfileId,
        class_id: assignment.classId,
        subject_id: assignment.subjectId,
        periods_per_week: assignment.periodsPerWeek,
        version_id: versionId,
      })),
    );

    if (insertError) throw insertError;
  }

  return { assignments: assignments.length };
}

/** Throw a draft away. Only a draft — a published or archived version is history. */
export async function deleteDraft(versionId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("timetable_versions")
    .delete()
    .eq("id", versionId)
    .eq("status", "draft");

  if (error) throw error;
}
