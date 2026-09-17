import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import { markChanged } from "@/modules/assessments/domain/assessments";
import type {
  Assessment,
  AssessmentInput,
  AssessmentKind,
  AssessmentStatus,
  AssessmentSubject,
  Mark,
  PaperInput,
} from "@/modules/assessments/domain/assessments";

/**
 * Exams, papers and marks.
 *
 * Every write goes through the service-role client after a permission check,
 * the way every other write in this app does (D-13). The one that is different
 * is `saveMark`, which writes a log row beside the mark — see its own note.
 */

/* ---------------------------------------------------------- assessments */

type AssessmentRow = {
  id: string;
  session_label: string;
  term: string;
  code: string;
  label_hi: string;
  label_en: string;
  kind: AssessmentKind;
  starts_on: string | null;
  ends_on: string | null;
  weight: number | string;
  status: AssessmentStatus;
  locked_at: string | null;
  staff_profiles: { display_name: string } | null;
};

const ASSESSMENT_COLUMNS =
  "id, session_label, term, code, label_hi, label_en, kind, starts_on, ends_on, " +
  "weight, status, locked_at, staff_profiles(display_name)";

const toAssessment = (row: AssessmentRow): Assessment => ({
  id: row.id,
  sessionLabel: row.session_label,
  term: row.term,
  code: row.code,
  labelHi: row.label_hi,
  labelEn: row.label_en,
  kind: row.kind,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  // `numeric` arrives as a string from PostgREST, and a string multiplied into
  // a report card's arithmetic is a silently wrong total.
  weight: Number(row.weight),
  status: row.status,
  lockedAt: row.locked_at,
  lockedByName: row.staff_profiles?.display_name ?? null,
});

export async function listAssessments(sessionLabel: string): Promise<Assessment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessments")
    .select(ASSESSMENT_COLUMNS)
    .eq("session_label", sessionLabel)
    .order("term")
    .order("code")
    .returns<AssessmentRow[]>();

  if (error) throw new Error(`Could not read the exams: ${error.message}`);
  return data.map(toAssessment);
}

export async function getAssessment(id: string): Promise<Assessment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessments")
    .select(ASSESSMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle<AssessmentRow>();

  if (error) throw new Error(`Could not read that exam: ${error.message}`);
  return data ? toAssessment(data) : null;
}

export async function upsertAssessment(
  input: AssessmentInput,
  sessionLabel: string,
  createdByUserId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("assessments")
    .upsert(
      {
        session_label: sessionLabel,
        term: input.term,
        code: input.code,
        label_hi: input.labelHi,
        label_en: input.labelEn,
        kind: input.kind,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        weight: input.weight,
        created_by: createdByUserId,
      },
      { onConflict: "session_label,term,code" },
    );

  if (error) throw error;
}

/**
 * Open, lock or return an exam to a draft.
 *
 * Locking stamps who and when, because a locked exam is the point after which
 * a changed mark needs explaining. Unlocking clears the stamp rather than
 * keeping a stale one — the change log is what remembers, and two records of
 * the same fact that can disagree are worse than one.
 */
export async function setAssessmentStatus(
  id: string,
  status: AssessmentStatus,
  staffProfileId: string,
): Promise<void> {
  const locked = status === "locked";

  const { error } = await createAdminClient()
    .from("assessments")
    .update({
      status,
      locked_at: locked ? new Date().toISOString() : null,
      locked_by: locked ? staffProfileId : null,
    })
    .eq("id", id);

  if (error) throw error;
}

export async function deleteAssessment(id: string): Promise<void> {
  // Only a draft. An exam anybody has entered a mark against is history, and
  // `on delete cascade` would take the marks and their log with it.
  const { error } = await createAdminClient()
    .from("assessments")
    .delete()
    .eq("id", id)
    .eq("status", "draft");

  if (error) throw error;
}

/* --------------------------------------------------------------- papers */

type PaperRow = {
  id: string;
  assessment_id: string;
  class_id: string;
  class_label: string;
  subject_id: string;
  subject_code: string;
  max_marks: number | string;
  pass_marks: number | string | null;
  sort_order: number;
};

const PAPER_COLUMNS =
  "id, assessment_id, class_id, class_label, subject_id, subject_code, " +
  "max_marks, pass_marks, sort_order";

const toPaper = (row: PaperRow): AssessmentSubject => ({
  id: row.id,
  assessmentId: row.assessment_id,
  classId: row.class_id,
  classLabel: row.class_label,
  subjectId: row.subject_id,
  subjectCode: row.subject_code,
  maxMarks: Number(row.max_marks),
  passMarks: row.pass_marks === null ? null : Number(row.pass_marks),
  sortOrder: row.sort_order,
});

export async function papersFor(assessmentId: string): Promise<AssessmentSubject[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_subjects")
    .select(PAPER_COLUMNS)
    .eq("assessment_id", assessmentId)
    .order("class_label")
    .order("sort_order")
    .returns<PaperRow[]>();

  if (error) throw new Error(`Could not read the papers: ${error.message}`);
  return data.map(toPaper);
}

export async function getPaper(id: string): Promise<AssessmentSubject | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_subjects")
    .select(PAPER_COLUMNS)
    .eq("id", id)
    .maybeSingle<PaperRow>();

  if (error) throw new Error(`Could not read that paper: ${error.message}`);
  return data ? toPaper(data) : null;
}

export async function upsertPaper(
  input: PaperInput,
  classLabel: string,
  subjectCode: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("assessment_subjects")
    .upsert(
      {
        assessment_id: input.assessmentId,
        class_id: input.classId,
        class_label: classLabel,
        subject_id: input.subjectId,
        subject_code: subjectCode,
        max_marks: input.maxMarks,
        pass_marks: input.passMarks,
        sort_order: input.sortOrder,
      },
      { onConflict: "assessment_id,class_id,subject_id" },
    );

  if (error) throw error;
}

export async function deletePaper(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("assessment_subjects")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

/** Every paper a class sits this session, across every exam. */
export async function papersForClass(
  classId: string,
  sessionLabel: string,
): Promise<AssessmentSubject[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_subjects")
    .select(`${PAPER_COLUMNS}, assessments!inner(session_label)`)
    .eq("class_id", classId)
    .eq("assessments.session_label", sessionLabel)
    .returns<PaperRow[]>();

  if (error) throw new Error(`Could not read the papers: ${error.message}`);
  return data.map(toPaper);
}

/* ---------------------------------------------------------------- marks */

type MarkRow = {
  id: string;
  assessment_subject_id: string;
  student_id: string;
  value: number | string | null;
  absent: boolean;
  entered_at: string;
  staff_profiles: { display_name: string } | null;
};

const MARK_COLUMNS =
  "id, assessment_subject_id, student_id, value, absent, entered_at, " +
  "staff_profiles(display_name)";

const toMark = (row: MarkRow): Mark => ({
  studentId: row.student_id,
  value: row.value === null ? null : Number(row.value),
  absent: row.absent,
  enteredByName: row.staff_profiles?.display_name ?? null,
  enteredAt: row.entered_at,
});

/** One paper's column of the grid. */
export async function marksForPaper(
  assessmentSubjectId: string,
): Promise<Map<string, Mark>> {
  await assertPermission("marks:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("marks")
    .select(MARK_COLUMNS)
    .eq("assessment_subject_id", assessmentSubjectId)
    .returns<MarkRow[]>();

  if (error) throw new Error(`Could not read the marks: ${error.message}`);
  return new Map(data.map((row) => [row.student_id, toMark(row)]));
}

/**
 * Every mark across a set of papers, keyed `${paperId}|${studentId}`.
 *
 * Paged: a term's marks for a whole school is a class times a subject times an
 * exam times a child, which passes a thousand rows on the second exam.
 */
export async function marksForPapers(
  paperIds: string[],
): Promise<Map<string, Mark>> {
  if (paperIds.length === 0) return new Map();
  await assertPermission("marks:view");

  const supabase = await createClient();

  const rows = await fetchAllRows<MarkRow>(
    (from, to) =>
      supabase
        .from("marks")
        .select(MARK_COLUMNS)
        .in("assessment_subject_id", paperIds)
        .order("id")
        .range(from, to)
        .returns<MarkRow[]>(),
    "the marks",
  );

  return new Map(
    rows.map((row) => [`${row.assessment_subject_id}|${row.student_id}`, toMark(row)]),
  );
}

export type MarkWrite = {
  studentId: string;
  value: number | null;
  absent: boolean;
};

/**
 * Save one cell, and record what it was.
 *
 * **The log is written from the value that was there, read in the same call.**
 * A mark that changes after a parent has seen it is the most sensitive write
 * in this app, and "it was 68 last week" has to have an answer that does not
 * depend on anybody remembering.
 *
 * Nothing is logged when nothing changed: a teacher tabbing through a grid
 * re-saves cells she did not touch, and a log full of 68 → 68 is a log nobody
 * reads — which is the same as not having one.
 */
export async function saveMark(input: {
  assessmentSubjectId: string;
  mark: MarkWrite;
  staffProfileId: string;
  reason: string | null;
}): Promise<{ changed: boolean }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("marks")
    .select("id, value, absent")
    .eq("assessment_subject_id", input.assessmentSubjectId)
    .eq("student_id", input.mark.studentId)
    .maybeSingle<{ id: string; value: number | string | null; absent: boolean }>();

  const before = {
    value: existing?.value === null || existing === null ? null : Number(existing.value),
    absent: existing?.absent ?? false,
  };

  // `markChanged()` owns what "unchanged" means — including that a missing row
  // and a blank row are the same state, which is what this got wrong until
  // somebody looked at the screen (D-80).
  const after = {
    value: input.mark.absent ? null : input.mark.value,
    absent: input.mark.absent,
  };

  if (!markChanged(before, after)) return { changed: false };

  const { error } = await admin.from("marks").upsert(
    {
      assessment_subject_id: input.assessmentSubjectId,
      student_id: input.mark.studentId,
      value: input.mark.absent ? null : input.mark.value,
      absent: input.mark.absent,
      entered_by: input.staffProfileId,
      entered_at: new Date().toISOString(),
    },
    { onConflict: "assessment_subject_id,student_id" },
  );

  if (error) throw error;

  const { error: logError } = await admin.from("marks_change_log").insert({
    assessment_subject_id: input.assessmentSubjectId,
    student_id: input.mark.studentId,
    from_value: before.value,
    to_value: after.value,
    from_absent: existing ? before.absent : null,
    to_absent: after.absent,
    reason: input.reason,
    changed_by: input.staffProfileId,
  });

  if (logError) throw logError;
  return { changed: true };
}

export type MarkChange = {
  id: string;
  studentId: string;
  studentName: string | null;
  fromValue: number | null;
  toValue: number | null;
  fromAbsent: boolean | null;
  toAbsent: boolean | null;
  reason: string | null;
  changedByName: string | null;
  changedAt: string;
};

export async function changeLogFor(
  assessmentSubjectId: string,
): Promise<MarkChange[]> {
  await assertPermission("marks:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("marks_change_log")
    .select(
      "id, student_id, from_value, to_value, from_absent, to_absent, reason, " +
        "changed_at, staff_profiles(display_name)",
    )
    .eq("assessment_subject_id", assessmentSubjectId)
    .order("changed_at", { ascending: false })
    .limit(200)
    .returns<
      {
        id: string;
        student_id: string;
        from_value: number | string | null;
        to_value: number | string | null;
        from_absent: boolean | null;
        to_absent: boolean | null;
        reason: string | null;
        changed_at: string;
        staff_profiles: { display_name: string } | null;
      }[]
    >();

  if (error) throw new Error(`Could not read the change log: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: null,
    fromValue: row.from_value === null ? null : Number(row.from_value),
    toValue: row.to_value === null ? null : Number(row.to_value),
    fromAbsent: row.from_absent,
    toAbsent: row.to_absent,
    reason: row.reason,
    changedByName: row.staff_profiles?.display_name ?? null,
    changedAt: row.changed_at,
  }));
}
