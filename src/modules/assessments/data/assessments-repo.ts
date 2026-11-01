import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import {
  toMarksReceipt,
  type MarksReceipt,
  type SaveMarksInput,
} from "@/modules/assessments/domain/marks-command";
import type { RollStudent } from "@/modules/attendance/domain/attendance";
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
 * the way every other write in this app does (D-13). Marks are different: they
 * are written only by `save_marks`, one database command per paper that checks
 * who, what and when again and writes the cells and their log together (P7).
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
  mark_step: number | string;
  allow_exempt: boolean;
  entry_status: "open" | "submitted";
  entry_revision: number;
  submitted_at: string | null;
};

const PAPER_COLUMNS =
  "id, assessment_id, class_id, class_label, subject_id, subject_code, " +
  "max_marks, pass_marks, sort_order, mark_step, allow_exempt, entry_status, entry_revision, submitted_at";

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
  markStep: Number(row.mark_step),
  allowExempt: row.allow_exempt,
  entryStatus: row.entry_status,
  entryRevision: row.entry_revision,
  submittedAt: row.submitted_at,
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
        mark_step: input.markStep,
        allow_exempt: input.allowExempt,
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
  exempt: boolean;
  entered_at: string;
  staff_profiles: { display_name: string } | null;
};

const MARK_COLUMNS =
  "id, assessment_subject_id, student_id, value, absent, exempt, entered_at, " +
  "staff_profiles(display_name)";

const toMark = (row: MarkRow): Mark => ({
  studentId: row.student_id,
  value: row.value === null ? null : Number(row.value),
  absent: row.absent,
  exempt: row.exempt,
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
  studentId?: string,
): Promise<Map<string, Mark>> {
  if (paperIds.length === 0) return new Map();
  await assertPermission("marks:view");

  const supabase = await createClient();

  const { data: rows } = await fetchInChunks<MarkRow>(
    [...new Set(paperIds)], IN_FILTER_CHUNK_SIZE, async ids => ({
      data: await fetchAllRows<MarkRow>((from, to) => {
        const query = supabase
        .from("marks")
        .select(MARK_COLUMNS)
        .in("assessment_subject_id", ids);
        // Individual profiles/report cards need one pupil; class exports keep
        // the existing unfiltered mode. The cookie client's RLS still applies.
        if (studentId !== undefined) query.eq("student_id", studentId);
        return query.order("id").range(from, to).returns<MarkRow[]>();
      }, "the marks"),
      error: null,
    }),
  );

  return new Map(
    rows.map((row) => [`${row.assessment_subject_id}|${row.student_id}`, toMark(row)]),
  );
}

/* ------------------------------------------------------ the command */

export type MarksOutcome =
  | { outcome: "saved"; receipt: MarksReceipt }
  | { outcome: "stale" }
  | { outcome: "incomplete"; blank: string[] }
  | { outcome: "invalid"; reason: string; studentId: string | null }
  | { outcome: "refused"; reason: string };

/**
 * Save one paper's marks: draft, submit, correct or reopen (P7).
 *
 * `save_marks` checks again who may enter this paper, that the exam is open,
 * the revision the page showed, every cell against the paper's scheme and
 * roll, and for a submission that nobody is left blank — then writes the
 * changed cells, a log row for each, the paper's new revision and the receipt
 * in one transaction. A refused cell leaves the whole column as it was. A
 * repeated `commandId` returns the first receipt.
 */
export async function saveMarksCommand(
  input: SaveMarksInput & {
    actorStaffId: string;
    payloadHash: string;
    fault?: "after_marks" | "before_receipt";
  },
): Promise<MarksOutcome> {
  const { data, error } = await createAdminClient().rpc("save_marks", {
    p: {
      command_id: input.commandId,
      actor_staff_id: input.actorStaffId,
      paper_id: input.paperId,
      kind: input.kind,
      expected_revision: input.expectedRevision,
      reason: input.reason,
      payload_hash: input.payloadHash,
      entries: input.entries.map((entry) => ({
        student_id: entry.studentId,
        state: entry.state,
        value: entry.state === "value" ? entry.value : null,
      })),
      fault: input.fault ?? null,
    },
  });

  if (error) {
    const named = error.message.match(/marks:([a-z_]+)(?::(.*))?/);
    if (!named) throw new Error(`Could not save the marks: ${error.message}`);
    const [, reason, detail] = named;
    if (reason === "incomplete") {
      return { outcome: "incomplete", blank: (detail ?? "").split(",").filter(Boolean) };
    }
    if (reason === "invalid_value" || reason === "exempt_not_allowed" || reason === "not_on_roll" || reason === "cannot_blank") {
      return { outcome: "invalid", reason, studentId: detail?.trim() || null };
    }
    if (reason.startsWith("injected_fault")) throw new Error(error.message);
    return { outcome: "refused", reason };
  }

  const row = data as Record<string, unknown>;
  if (row.ok === true) return { outcome: "saved", receipt: toMarksReceipt(row) };
  if (row.reason === "stale") return { outcome: "stale" };
  return { outcome: "refused", reason: String(row.reason ?? "failed") };
}

/** Whether a save with this id landed — asked after an answer that never came. */
export async function findMarksCommand(commandId: string, actorStaffId: string): Promise<MarksReceipt | null> {
  const { data, error } = await createAdminClient()
    .from("marks_commands")
    .select("receipt")
    .eq("id", commandId)
    .eq("actor_staff_id", actorStaffId)
    .maybeSingle<{ receipt: Record<string, unknown> }>();
  if (error) throw new Error(`Could not check the save: ${error.message}`);
  return data ? toMarksReceipt({ ...data.receipt, replayed: true }) : null;
}

/** The latest committed receipt for a paper, for "Submitted by … at …". */
export async function latestMarksReceipt(paperId: string): Promise<MarksReceipt | null> {
  const { data, error } = await createAdminClient()
    .from("marks_commands")
    .select("receipt")
    .eq("assessment_subject_id", paperId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ receipt: Record<string, unknown> }>();
  if (error) throw new Error(`Could not read the receipt: ${error.message}`);
  return data ? toMarksReceipt(data.receipt) : null;
}

/**
 * Who sat a paper: the class roll during its exam, by the database's rule
 * (`vppsone.paper_roster`) — the same rule the save applies. Every caller has
 * already decided this reader may see the paper.
 */
export async function rosterForPaper(paperId: string): Promise<RollStudent[]> {
  await assertPermission("marks:view");
  const admin = createAdminClient();
  const { data: ids, error } = await admin.rpc("paper_roster", { p_paper: paperId });
  if (error) throw new Error(`Could not read who sat the paper: ${error.message}`);
  const studentIds = ((ids ?? []) as string[]).filter(Boolean);
  if (studentIds.length === 0) return [];

  const { data: paper } = await admin
    .from("assessment_subjects")
    .select("assessments!inner(session_label)")
    .eq("id", paperId)
    .single<{ assessments: { session_label: string } }>();

  const [enrolments, students] = await Promise.all([
    fetchInChunks<{ student_id: string; roll_no: string | null }>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin
        .from("enrolments")
        .select("student_id, roll_no")
        .eq("session_label", paper?.assessments.session_label ?? "")
        .in("student_id", chunk),
    ),
    fetchInChunks<{ id: string; full_name: string; admission_no: string | null }>(
      studentIds,
      IN_FILTER_CHUNK_SIZE,
      (chunk) => admin.schema(FEE_SCHEMA).from("students").select("id, full_name, admission_no").in("id", chunk),
    ),
  ]);
  if (enrolments.error || students.error) throw new Error("Could not read who sat the paper.");

  const rollNo = new Map(enrolments.data.map((row) => [row.student_id, row.roll_no]));
  const byId = new Map(students.data.map((row) => [row.id, row]));
  return studentIds.map((studentId) => ({
    studentId,
    fullName: byId.get(studentId)?.full_name ?? "—",
    admissionNo: byId.get(studentId)?.admission_no ?? null,
    rollNo: rollNo.get(studentId) ?? null,
  }));
}

/** Whether the published timetable gives this subject in this class to this person. */
export async function isAssignedTo(input: {
  staffProfileId: string;
  sessionLabel: string;
  classId: string;
  subjectId: string;
}): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("teaching_assignments")
    .select("id")
    .eq("staff_profile_id", input.staffProfileId)
    .eq("session_label", input.sessionLabel)
    .eq("class_id", input.classId)
    .eq("subject_id", input.subjectId)
    .limit(1);
  if (error) throw new Error(`Could not read your subjects: ${error.message}`);
  return (data ?? []).length > 0;
}

export type MarkChange = {
  id: string;
  studentId: string;
  studentName: string | null;
  fromValue: number | null;
  toValue: number | null;
  fromAbsent: boolean | null;
  toAbsent: boolean | null;
  fromExempt: boolean | null;
  toExempt: boolean | null;
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
      "id, student_id, from_value, to_value, from_absent, to_absent, from_exempt, to_exempt, reason, " +
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
        from_exempt: boolean | null;
        to_exempt: boolean | null;
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
    fromExempt: row.from_exempt,
    toExempt: row.to_exempt,
    reason: row.reason,
    changedByName: row.staff_profiles?.display_name ?? null,
    changedAt: row.changed_at,
  }));
}
