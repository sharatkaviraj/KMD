import "server-only";

import { viewingTestSession } from "@/platform/auth/staff-scope";
import { FEE_SCHEMA } from "@/platform/env";
import { chunkArray, fetchInChunks, mapConcurrently } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { schoolToday } from "@/platform/dates";
import type { Assessment, AssessmentKind, AssessmentStatus } from "@/modules/assessments/domain/assessments";

import { openExamsForMarks, pickCurrentExam } from "./domain/current";
import { cellOf, countPaper } from "./domain/progress";
import { onRoll, type EnrolmentFacts, type PaperFacts } from "./domain/tracker";
import type { Cell } from "./domain/entry";

/*
 * Reads for the exam screens. Every caller has already checked the
 * permission for what it shows (the page guard, or the action's assert), and
 * scopes rows to the reader before they leave the server: a teacher's screen
 * is given her papers, never the school's with the rest hidden in the browser.
 *
 * `.in(...)` lists are chunked (CLAUDE.md rule 3b) and long reads are paged.
 */

const admin = () => createAdminClient();

export type ExamPlan = {
  marksDueOn: string | null;
  resultsOn: string | null;
  ptmAt: string | null;
  reportingTime: string;
  copiedFrom: string | null;
  datesheetCheckedAt: string | null;
  datesheetPublishedAt: string | null;
  graceMax: number;
  graceSubjects: number;
  resultsPublishAt: string | null;
  resultsPublishedAt: string | null;
  channels: { whatsapp: boolean; ptm: boolean };
  checklist: Record<string, { at: string; by?: string }>;
};

export type Exam = {
  id: string;
  sessionLabel: string;
  term: string;
  code: string;
  labelEn: string;
  labelHi: string;
  kind: AssessmentKind;
  startsOn: string | null;
  endsOn: string | null;
  status: AssessmentStatus;
  weight: number;
  papers: number;
  plan: ExamPlan | null;
};

type PlanRow = {
  assessment_id: string;
  marks_due_on: string | null;
  results_on: string | null;
  ptm_at: string | null;
  reporting_time: string;
  copied_from: string | null;
  datesheet_checked_at: string | null;
  datesheet_published_at: string | null;
  grace_max: number | string;
  grace_subjects: number;
  results_publish_at: string | null;
  results_published_at: string | null;
  results_channels: { whatsapp?: boolean; ptm?: boolean } | null;
  checklist: Record<string, { at: string; by?: string }> | null;
};

const toPlan = (row: PlanRow): ExamPlan => ({
  marksDueOn: row.marks_due_on,
  resultsOn: row.results_on,
  ptmAt: row.ptm_at ? row.ptm_at.slice(0, 5) : null,
  reportingTime: (row.reporting_time ?? "08:15").slice(0, 5),
  copiedFrom: row.copied_from,
  datesheetCheckedAt: row.datesheet_checked_at,
  datesheetPublishedAt: row.datesheet_published_at,
  graceMax: Number(row.grace_max),
  graceSubjects: row.grace_subjects,
  resultsPublishAt: row.results_publish_at,
  resultsPublishedAt: row.results_published_at,
  channels: { whatsapp: row.results_channels?.whatsapp !== false, ptm: row.results_channels?.ptm !== false },
  checklist: row.checklist ?? {},
});

/** Every exam of the session with its plan and how many papers it has, in date order. */
export async function listExams(sessionLabel: string): Promise<Exam[]> {
  const db = admin();
  const { data, error } = await db
    .from("assessments")
    .select("id, session_label, term, code, label_en, label_hi, kind, starts_on, ends_on, status, weight, assessment_subjects(count)")
    .eq("session_label", sessionLabel)
    .returns<
      {
        id: string;
        session_label: string;
        term: string;
        code: string;
        label_en: string;
        label_hi: string;
        kind: AssessmentKind;
        starts_on: string | null;
        ends_on: string | null;
        status: AssessmentStatus;
        weight: number | string;
        assessment_subjects: { count: number }[];
      }[]
    >();
  if (error) throw new Error(`Could not read the exams: ${error.message}`);
  const ids = data.map((row) => row.id);
  const plans = await fetchInChunks<PlanRow>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    db.from("exam_plans").select("*").in("assessment_id", chunk),
  );
  if (plans.error) throw new Error("Could not read the exam plans.");
  const planOf = new Map(plans.data.map((row) => [row.assessment_id, toPlan(row)]));
  return data
    .map((row) => ({
      id: row.id,
      sessionLabel: row.session_label,
      term: row.term,
      code: row.code,
      labelEn: row.label_en,
      labelHi: row.label_hi,
      kind: row.kind,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      status: row.status,
      weight: Number(row.weight),
      papers: row.assessment_subjects?.[0]?.count ?? 0,
      plan: planOf.get(row.id) ?? null,
    }))
    .sort((a, b) => (a.startsOn ?? "9999").localeCompare(b.startsOn ?? "9999") || a.code.localeCompare(b.code));
}

/**
 * The exam marks are being worked on: the latest open, dated exam with papers
 * that has begun — never an undated one while a dated one exists. The rule is
 * `pickCurrentExam` in `domain/current.ts`; `openExamsForMarks` there lists
 * every open exam for a teacher's marks tab.
 */
export function currentExam(exams: Exam[], today: string, requested?: string | null): Exam | null {
  return pickCurrentExam(exams, today, requested);
}

export { openExamsForMarks, pickCurrentExam };

/** The next exam to plan: the first that has not begun, else the latest. */
export function nextExam(exams: Exam[], today: string, requested?: string | null): Exam | null {
  if (requested) {
    const asked = exams.find((e) => e.id === requested);
    if (asked) return asked;
  }
  return exams.find((e) => e.startsOn && e.startsOn > today) ?? exams.at(-1) ?? null;
}

/** The exam before this one in the same session, for "last test" and moderation. */
export function previousExam(exams: Exam[], exam: Exam): Exam | null {
  const before = exams.filter((e) => e.id !== exam.id && e.papers > 0 && (e.startsOn ?? "") < (exam.startsOn ?? ""));
  return before.at(-1) ?? null;
}

export function toAssessment(exam: Exam): Assessment {
  return {
    id: exam.id,
    sessionLabel: exam.sessionLabel,
    term: exam.term,
    code: exam.code,
    labelEn: exam.labelEn,
    labelHi: exam.labelHi,
    kind: exam.kind,
    startsOn: exam.startsOn,
    endsOn: exam.endsOn,
    weight: exam.weight,
    status: exam.status,
    lockedAt: null,
    lockedByName: null,
  };
}

/* ------------------------------------------------------------- classes */

export type ClassInfo = { id: string; label: string; sort: number; classTeacherId: string | null; classTeacherName: string | null };

export async function classesFor(sessionLabel: string): Promise<ClassInfo[]> {
  const db = admin();
  const [{ data: classes, error }, { data: cts }] = await Promise.all([
    db
      .schema(FEE_SCHEMA)
      .from("classes")
      .select("id, class_name, sort_order")
      .eq("session_label", sessionLabel)
      .order("sort_order")
      .returns<{ id: string; class_name: string; sort_order: number | null }[]>(),
    db
      .from("class_teachers")
      .select("class_id, staff_profile_id, effective_to, staff_profiles(display_name)")
      .eq("session_label", sessionLabel)
      .eq("role", "class_teacher")
      .is("effective_to", null)
      .returns<{ class_id: string; staff_profile_id: string; staff_profiles: { display_name: string } | null }[]>(),
  ]);
  if (error) throw new Error(`Could not read the classes: ${error.message}`);
  const teacher = new Map((cts ?? []).map((row) => [row.class_id, row]));
  return (classes ?? []).map((row) => ({
    id: row.id,
    label: row.class_name,
    sort: row.sort_order ?? 0,
    classTeacherId: teacher.get(row.id)?.staff_profile_id ?? null,
    classTeacherName: teacher.get(row.id)?.staff_profiles?.display_name ?? null,
  }));
}

/* ---------------------------------------------------------------- staff */

export type StaffLite = { id: string; name: string; shortName: string; role: string; phone: string | null; isTeaching: boolean };

/**
 * The active staff of the session being looked at: test accounts only in a
 * test session (a TEST exam's duty sharing, setter picker and reminders
 * otherwise offered real teachers, and "Share duties" wrote real teachers onto
 * a TEST exam — exam-office replay E09, 6 Nov 2026), and real staff only in the
 * real year, where the QA accounts used to be offered too (owner, 8 Nov 2026).
 */
export async function staffList(): Promise<StaffLite[]> {
  const testSession = await viewingTestSession();
  const query = admin()
    .from("staff_profiles")
    .select("id, display_name, short_name, role, phone, whatsapp_phone, is_teaching, is_active")
    .eq("is_active", true)
    .eq("is_test_account", testSession);
  const { data, error } = await query
    .order("display_name")
    .returns<{ id: string; display_name: string; short_name: string; role: string; phone: string | null; whatsapp_phone: string | null; is_teaching: boolean }[]>();
  if (error) throw new Error(`Could not read the staff: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    name: row.display_name,
    shortName: row.short_name,
    role: row.role,
    phone: row.whatsapp_phone ?? row.phone,
    isTeaching: row.is_teaching,
  }));
}

/* ------------------------------------------------------- papers & marks */

export type PaperRow = {
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
  submitted_by: string | null;
  /** When the paper went to the exam office by itself after the marks due day (D-651); "sent by itself" only while it equals `submitted_at`. */
  sent_itself_at?: string | null;
};

const PAPER_COLUMNS =
  "id, assessment_id, class_id, class_label, subject_id, subject_code, max_marks, pass_marks, sort_order, mark_step, allow_exempt, entry_status, entry_revision, submitted_at, submitted_by, sent_itself_at";

export async function papersOf(assessmentIds: string[]): Promise<PaperRow[]> {
  if (assessmentIds.length === 0) return [];
  const db = admin();
  const all: PaperRow[] = [];
  for (const chunk of chunkArray(assessmentIds, IN_FILTER_CHUNK_SIZE)) {
    const rows = await fetchAllRows<PaperRow>(
      (from, to) =>
        db.from("assessment_subjects").select(PAPER_COLUMNS).in("assessment_id", chunk).order("id").range(from, to).returns<PaperRow[]>(),
      "the papers",
    );
    all.push(...rows);
  }
  return all;
}

export async function paperById(id: string): Promise<PaperRow | null> {
  const { data, error } = await admin().from("assessment_subjects").select(PAPER_COLUMNS).eq("id", id).maybeSingle<PaperRow>();
  if (error) throw new Error(`Could not read that paper: ${error.message}`);
  return data;
}

export type MarkRow = { assessment_subject_id: string; student_id: string; value: number | string | null; absent: boolean; exempt: boolean };

/** Every mark on these papers, chunked by paper and paged. */
export async function marksOf(paperIds: string[]): Promise<MarkRow[]> {
  if (paperIds.length === 0) return [];
  const db = admin();
  const chunks = chunkArray(paperIds, 100);
  const parts = await mapConcurrently(chunks, 3, (chunk) =>
    fetchAllRows<MarkRow>(
      (from, to) =>
        db
          .from("marks")
          .select("assessment_subject_id, student_id, value, absent, exempt")
          .in("assessment_subject_id", chunk)
          .order("id")
          .range(from, to)
          .returns<MarkRow[]>(),
      "the marks",
    ),
  );
  return parts.flat();
}

/** A marks row as the sheet holds it — the shared rule in `domain/progress.ts`. */
export function toCell(row: MarkRow | undefined): Cell {
  return cellOf(row);
}

export async function enrolmentsFor(sessionLabel: string, classIds?: string[]): Promise<RollEntry[]> {
  const db = admin();
  type Row = { student_id: string; class_id: string; status: string; enrolled_on: string | null; left_on: string | null; roll_no: string | null };
  let rows: Row[];
  if (classIds) {
    const res = await fetchInChunks<Row>(classIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      db.from("enrolments").select("student_id, class_id, status, enrolled_on, left_on, roll_no").eq("session_label", sessionLabel).in("class_id", chunk),
    );
    if (res.error) throw new Error("Could not read the class rolls.");
    rows = res.data;
  } else {
    rows = await fetchAllRows<Row>(
      (from, to) =>
        db
          .from("enrolments")
          .select("student_id, class_id, status, enrolled_on, left_on, roll_no")
          .eq("session_label", sessionLabel)
          .order("id")
          .range(from, to)
          .returns<Row[]>(),
      "the class rolls",
    );
  }
  return rows.map((r) => ({ studentId: r.student_id, classId: r.class_id, status: r.status, enrolledOn: r.enrolled_on, leftOn: r.left_on, roll: r.roll_no }));
}

export type RollEntry = EnrolmentFacts & { roll?: string | null };

export type StudentLite = { id: string; name: string; admissionNo: string | null; fatherName: string | null };

export async function studentsByIds(ids: string[]): Promise<Map<string, StudentLite>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const res = await fetchInChunks<{ id: string; full_name: string; admission_no: string | null; father_name: string | null }>(
    unique,
    IN_FILTER_CHUNK_SIZE,
    (chunk) => admin().schema(FEE_SCHEMA).from("students").select("id, full_name, admission_no, father_name").in("id", chunk),
  );
  if (res.error) throw new Error("Could not read the children's names.");
  return new Map(res.data.map((s) => [s.id, { id: s.id, name: s.full_name, admissionNo: s.admission_no, fatherName: s.father_name }]));
}

export type Assignment = { staffId: string; classId: string; subjectId: string };

export async function assignmentsFor(sessionLabel: string, staffId?: string): Promise<Assignment[]> {
  let query = admin().from("teaching_assignments").select("staff_profile_id, class_id, subject_id").eq("session_label", sessionLabel);
  if (staffId) query = query.eq("staff_profile_id", staffId);
  const { data, error } = await query.returns<{ staff_profile_id: string; class_id: string; subject_id: string }[]>();
  if (error) throw new Error(`Could not read who teaches what: ${error.message}`);
  return data.map((r) => ({ staffId: r.staff_profile_id, classId: r.class_id, subjectId: r.subject_id }));
}

/**
 * The tracker's view of an exam: each paper with its teacher, its roll and
 * how many children have something entered. `onlyPapers` narrows it to the
 * papers a reader may see.
 */
export async function trackerFor(input: {
  exam: Exam;
  classes: ClassInfo[];
  staff: StaffLite[];
  today?: string;
  onlyPapers?: (paper: PaperRow) => boolean;
  /** This exam's papers when the caller has already read them. */
  rows?: PaperRow[];
}): Promise<{ papers: PaperFacts[]; rows: PaperRow[]; marks: MarkRow[]; roll: Map<string, RollEntry[]> }> {
  const today = input.today ?? schoolToday();
  let rows = input.rows ? input.rows.filter((r) => r.assessment_id === input.exam.id) : await papersOf([input.exam.id]);
  if (input.onlyPapers) rows = rows.filter(input.onlyPapers);
  const classIds = [...new Set(rows.map((r) => r.class_id))];
  const [marks, enrolments, assignments] = await Promise.all([
    marksOf(rows.map((r) => r.id)),
    enrolmentsFor(input.exam.sessionLabel, classIds),
    assignmentsFor(input.exam.sessionLabel),
  ]);
  const roll = new Map<string, RollEntry[]>();
  for (const e of enrolments) {
    if (!onRoll(e, input.exam, today)) continue;
    roll.set(e.classId, [...(roll.get(e.classId) ?? []), e]);
  }
  // Counted by the one contract every marks surface uses (domain/progress.ts).
  const marksBy = new Map<string, { studentId: string; value: number | string | null; absent: boolean; exempt: boolean }[]>();
  for (const m of marks) {
    const list = marksBy.get(m.assessment_subject_id) ?? [];
    list.push({ studentId: m.student_id, value: m.value, absent: m.absent, exempt: m.exempt });
    marksBy.set(m.assessment_subject_id, list);
  }
  const classOf = new Map(input.classes.map((c) => [c.id, c]));
  const staffName = new Map(input.staff.map((s) => [s.id, s.name]));
  const teacherOf = new Map<string, string>();
  for (const a of assignments) {
    const key = `${a.classId}|${a.subjectId}`;
    if (!teacherOf.has(key)) teacherOf.set(key, a.staffId);
  }
  const papers: PaperFacts[] = rows.map((r) => {
    const kids = roll.get(r.class_id) ?? [];
    // A paper nobody is assigned to is the class teacher's to chase, as the
    // coordinator's home has always counted it — otherwise it is late with
    // nobody to remind, and the two screens disagree on who is behind.
    const teacherId = teacherOf.get(`${r.class_id}|${r.subject_id}`) ?? classOf.get(r.class_id)?.classTeacherId ?? null;
    const count = countPaper(
      kids.map((k) => k.studentId),
      marksBy.get(r.id) ?? [],
      { maxMarks: Number(r.max_marks), markStep: Number(r.mark_step) },
    );
    return {
      paperId: r.id,
      classId: r.class_id,
      classLabel: r.class_label,
      classSort: classOf.get(r.class_id)?.sort ?? 999,
      subjectCode: r.subject_code,
      teacherId,
      teacherName: teacherId ? (staffName.get(teacherId) ?? null) : null,
      total: count.eligible,
      entered: count.saved,
      invalid: count.invalid,
      absent: count.absent,
      exempt: count.exempt,
      blank: count.blank,
      markStep: Number(r.mark_step),
      entryStatus: r.entry_status,
      entryRevision: r.entry_revision,
      maxMarks: Number(r.max_marks),
      passMarks: r.pass_marks === null ? null : Number(r.pass_marks),
    };
  });
  return { papers, rows, marks, roll };
}

/* ---------------------------------------------------- the exam office */

export type SlotRow = { id: string; assessment_id: string; group_key: string; subject_label: string; sits_on: string; starts_at: string; minutes: number; sort_order: number };

export async function slotsFor(assessmentId: string): Promise<SlotRow[]> {
  const { data, error } = await admin()
    .from("exam_slots")
    .select("id, assessment_id, group_key, subject_label, sits_on, starts_at, minutes, sort_order")
    .eq("assessment_id", assessmentId)
    .order("sits_on")
    .order("starts_at")
    .returns<SlotRow[]>();
  if (error) throw new Error(`Could not read the date sheet: ${error.message}`);
  return data.map((s) => ({ ...s, starts_at: s.starts_at.slice(0, 5) }));
}

export type RoomRow = { id: string; name: string; seats: number; cols: number; sort_order: number; is_active: boolean };

export async function rooms(): Promise<RoomRow[]> {
  const { data, error } = await admin().from("exam_rooms").select("id, name, seats, cols, sort_order, is_active").order("sort_order").order("name").returns<RoomRow[]>();
  if (error) throw new Error(`Could not read the rooms: ${error.message}`);
  return data;
}

export type SeatRow = { room_id: string; seat_no: number; class_id: string; student_id: string };

export async function seatsFor(assessmentId: string): Promise<SeatRow[]> {
  return fetchAllRows<SeatRow>(
    (from, to) =>
      admin().from("exam_seats").select("room_id, seat_no, class_id, student_id").eq("assessment_id", assessmentId).order("id").range(from, to).returns<SeatRow[]>(),
    "the seating",
  );
}

export type DutyRow = { id: string; sits_on: string; room_id: string; staff_profile_id: string };

export async function dutiesFor(assessmentId: string): Promise<DutyRow[]> {
  const { data, error } = await admin().from("exam_duties").select("id, sits_on, room_id, staff_profile_id").eq("assessment_id", assessmentId).returns<DutyRow[]>();
  if (error) throw new Error(`Could not read the duties: ${error.message}`);
  return data;
}

export type QuestionPaperRow = { id: string; slot_id: string; setter_staff_id: string | null; status: "waiting" | "received" | "checked" | "printed"; updated_at: string };

export async function questionPapersFor(slotIds: string[]): Promise<QuestionPaperRow[]> {
  const res = await fetchInChunks<QuestionPaperRow>(slotIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin().from("exam_question_papers").select("id, slot_id, setter_staff_id, status, updated_at").in("slot_id", chunk),
  );
  if (res.error) throw new Error("Could not read the question papers.");
  return res.data;
}

export type ActivityRow = { id: string; kind: string; text_en: string; text_hi: string | null; created_at: string };

export async function activityFor(assessmentIds: string[], limit = 12): Promise<ActivityRow[]> {
  if (assessmentIds.length === 0) return [];
  const { data, error } = await admin()
    .from("exam_activity")
    .select("id, kind, text_en, text_hi, created_at")
    .in("assessment_id", assessmentIds.slice(0, IN_FILTER_CHUNK_SIZE))
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<ActivityRow[]>();
  if (error) throw new Error(`Could not read what happened: ${error.message}`);
  return data;
}

export async function logActivity(input: { assessmentId: string | null; kind: string; en: string; hi?: string; actorId: string }): Promise<void> {
  await admin().from("exam_activity").insert({
    assessment_id: input.assessmentId,
    kind: input.kind,
    text_en: input.en,
    text_hi: input.hi ?? null,
    actor_staff_id: input.actorId,
  });
}

export async function locksFor(assessmentId: string): Promise<Map<string, { lockedAt: string; lockedBy: string }>> {
  const { data, error } = await admin()
    .from("exam_class_locks")
    .select("class_id, locked_at, locked_by")
    .eq("assessment_id", assessmentId)
    .returns<{ class_id: string; locked_at: string; locked_by: string }[]>();
  if (error) throw new Error(`Could not read the locks: ${error.message}`);
  return new Map(data.map((r) => [r.class_id, { lockedAt: r.locked_at, lockedBy: r.locked_by }]));
}

export async function moderationFor(paperIds: string[]): Promise<Map<string, { decision: "fine" | "recheck"; note: string | null }>> {
  const res = await fetchInChunks<{ paper_id: string; decision: "fine" | "recheck"; note: string | null }>(paperIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin().from("exam_moderation").select("paper_id, decision, note").in("paper_id", chunk),
  );
  if (res.error) throw new Error("Could not read the moderation.");
  return new Map(res.data.map((r) => [r.paper_id, { decision: r.decision, note: r.note }]));
}

export type GraceRow = { id: string; paper_id: string; student_id: string; grace: number | string };

export async function graceFor(paperIds: string[]): Promise<GraceRow[]> {
  const res = await fetchInChunks<GraceRow>(paperIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin().from("exam_grace").select("id, paper_id, student_id, grace").in("paper_id", chunk),
  );
  if (res.error) throw new Error("Could not read the grace marks.");
  return res.data;
}

export type RecheckRow = {
  id: string;
  paper_id: string;
  student_id: string;
  asked_by: string;
  note: string | null;
  status: "new" | "with_teacher" | "changed" | "no_change";
  old_value: number | string | null;
  new_value: number | string | null;
  created_at: string;
  resolved_at: string | null;
};

export async function rechecksFor(paperIds: string[]): Promise<RecheckRow[]> {
  const res = await fetchInChunks<RecheckRow>(paperIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin()
      .from("exam_rechecks")
      .select("id, paper_id, student_id, asked_by, note, status, old_value, new_value, created_at, resolved_at")
      .in("paper_id", chunk),
  );
  if (res.error) throw new Error("Could not read the recheck requests.");
  return res.data.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Children with an issued card for the term. With `since` (an exam's first
 * day), only cards issued on or after it: a card issued before the exam began
 * cannot carry its marks, so it does not count as this exam's card
 * (coordinators B6 — a 22 Sep card showed as "1 of 507" for the half-yearly).
 */
export async function issuedStudents(sessionLabel: string, term: string, since?: string | null): Promise<Set<string>> {
  const rows = await fetchAllRows<{ student_id: string }>(
    (from, to) => {
      let query = admin()
        .from("report_card_issues")
        .select("student_id")
        .eq("session_label", sessionLabel)
        .eq("term", term)
        .eq("status", "issued");
      if (since) query = query.gte("issued_at", `${since}T00:00:00+05:30`);
      return query.order("id").range(from, to).returns<{ student_id: string }[]>();
    },
    "the issued cards",
  );
  return new Set(rows.map((r) => r.student_id));
}

export async function remarksFor(sessionLabel: string, term: string, studentIds: string[]): Promise<Map<string, string>> {
  const res = await fetchInChunks<{ student_id: string; remark: string }>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin().from("report_card_remarks").select("student_id, remark").eq("session_label", sessionLabel).eq("term", term).in("student_id", chunk),
  );
  if (res.error) throw new Error("Could not read the remarks.");
  return new Map(res.data.map((r) => [r.student_id, r.remark]));
}

export type LinkRow = { id: string; assessment_id: string; staff_profile_id: string; token: string; created_at: string; last_opened_at: string | null };

/** A teacher's note about a child, as the remarks screen shows it beside the card. */
export type ChildNote = { text: string; when: string; by: string; kind: { en: string; hi: string } };

/** Health and family notes stay out of report-card remarks, as out of every summary. */
const PRIVATE_TAGS = ["health", "family"];

/**
 * The latest notes staff shared about each child this session (D-612): the
 * class teacher writes the card's remark from them, and the AI draft reads
 * them with every name masked. "Only me" notes and health and family notes
 * are never read here.
 */
export async function remarkNotesFor(sessionLabel: string, studentIds: string[], perChild = 4): Promise<Map<string, ChildNote[]>> {
  const out = new Map<string, ChildNote[]>();
  if (!studentIds.length) return out;
  type Row = { student_id: string; body: string; tags: string[] | null; created_at: string; note_kinds: { label_en: string; label_hi: string } | null; staff_profiles: { display_name: string } | null };
  const res = await fetchInChunks<Row>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin()
      .from("notes")
      .select("student_id, body, tags, created_at, note_kinds(label_en, label_hi), staff_profiles!notes_written_by_fkey(display_name)")
      .eq("session_label", sessionLabel)
      .eq("visibility", "team")
      .in("student_id", chunk)
      .order("created_at", { ascending: false })
      .limit(chunk.length * 12)
      .returns<Row[]>(),
  );
  if (res.error) return out;
  for (const row of res.data) {
    if (!row.body?.trim() || (row.tags ?? []).some((t) => PRIVATE_TAGS.includes(t))) continue;
    const list = out.get(row.student_id) ?? [];
    if (list.length >= perChild) continue;
    list.push({ text: row.body.trim().slice(0, 400), when: row.created_at.slice(0, 10), by: row.staff_profiles?.display_name ?? "—", kind: { en: row.note_kinds?.label_en ?? "Note", hi: row.note_kinds?.label_hi ?? "नोट" } });
    out.set(row.student_id, list);
  }
  return out;
}

export async function liveLinks(assessmentId: string): Promise<LinkRow[]> {
  const { data, error } = await admin()
    .from("exam_marks_links")
    .select("id, assessment_id, staff_profile_id, token, created_at, last_opened_at")
    .eq("assessment_id", assessmentId)
    .is("revoked_at", null)
    .returns<LinkRow[]>();
  if (error) throw new Error(`Could not read the marks links: ${error.message}`);
  return data;
}

export async function remindersFor(assessmentId: string): Promise<Map<string, string>> {
  const { data, error } = await admin()
    .from("exam_reminders")
    .select("staff_profile_id, sent_at")
    .eq("assessment_id", assessmentId)
    .order("sent_at", { ascending: false })
    .returns<{ staff_profile_id: string; sent_at: string }[]>();
  if (error) throw new Error(`Could not read the reminders: ${error.message}`);
  const last = new Map<string, string>();
  for (const r of data) if (!last.has(r.staff_profile_id)) last.set(r.staff_profile_id, r.sent_at);
  return last;
}

/** Days the school is shut, from the academic calendar, when it has any. */
export async function holidaysBetween(sessionLabel: string, from: string | null, to: string | null): Promise<Set<string>> {
  if (!from || !to) return new Set();
  const { data } = await admin()
    .from("academic_calendar_days")
    .select("day, kind")
    .eq("session_label", sessionLabel)
    .gte("day", from)
    .lte("day", to)
    .returns<{ day: string; kind: string }[]>();
  return new Set((data ?? []).filter((d) => /holiday|closed|vacation/i.test(d.kind)).map((d) => d.day));
}

export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}

export function marksLinkUrl(token: string): string {
  return `${siteOrigin()}/t/marks/${token}`;
}

/* ------------------------------------------------- remarks' evidence */

/**
 * Each child's attendance in a class this session: present days over the
 * days the register was taken, a half day counting half. Days nobody took the
 * register are not counted either way.
 */
export async function attendanceFor(classId: string, sessionLabel: string): Promise<Map<string, number>> {
  const db = admin();
  const registers = await fetchAllRows<{ id: string }>(
    (from, to) =>
      db
        .from("attendance_registers")
        .select("id")
        .eq("session_label", sessionLabel)
        .eq("class_id", classId)
        .is("period", null)
        .gte("revision", 1)
        .order("id")
        .range(from, to)
        .returns<{ id: string }[]>(),
    "the registers",
  );
  if (registers.length === 0) return new Map();
  const marks = await fetchInChunks<{ student_id: string; status: string }>(
    registers.map((r) => r.id),
    IN_FILTER_CHUNK_SIZE,
    (chunk) => db.from("attendance_marks").select("student_id, status").in("register_id", chunk).limit(20000),
  );
  if (marks.error) return new Map();
  const tally = new Map<string, { present: number; counted: number }>();
  for (const m of marks.data) {
    const t = tally.get(m.student_id) ?? { present: 0, counted: 0 };
    const s = m.status.toUpperCase();
    if (s.startsWith("P")) t.present += 1;
    else if (s.startsWith("H")) t.present += 0.5;
    t.counted += 1;
    tally.set(m.student_id, t);
  }
  // A remark must not judge a term on a day or two: one absence on the only
  // marked day read "attendance 0%" and the suggestion told the child to come
  // to school more (6 Nov school day). Below this many days there is no figure.
  return new Map([...tally].filter(([, t]) => t.counted >= MIN_DAYS_FOR_REMARK).map(([id, t]) => [id, Math.round((t.present / t.counted) * 100)]));
}

/** Registers a child must have been on before a remark may speak about their attendance. */
export const MIN_DAYS_FOR_REMARK = 10;

export type TermStanding = { percent: number | null; strongest: string | null; weakest: string | null; perSubject: Map<string, number> };

/** A child's term so far across every exam of the term: overall percentage and best and weakest subjects. */
export function termStanding(papers: PaperRow[], marks: MarkRow[], studentId: string): TermStanding {
  const paperOf = new Map(papers.map((p) => [p.id, p]));
  const bySubject = new Map<string, { got: number; max: number }>();
  let got = 0;
  let max = 0;
  for (const m of marks) {
    if (m.student_id !== studentId || m.exempt) continue;
    const paper = paperOf.get(m.assessment_subject_id);
    if (!paper) continue;
    const value = m.absent || m.value === null ? 0 : Number(m.value);
    if (!m.absent && m.value === null) continue;
    const pm = Number(paper.max_marks);
    got += value;
    max += pm;
    const s = bySubject.get(paper.subject_code) ?? { got: 0, max: 0 };
    s.got += value;
    s.max += pm;
    bySubject.set(paper.subject_code, s);
  }
  const perSubject = new Map([...bySubject].map(([k, v]) => [k, v.max ? Math.round((v.got / v.max) * 100) : 0]));
  const ranked = [...perSubject].sort((a, b) => b[1] - a[1]);
  return {
    percent: max ? Math.round((got / max) * 1000) / 10 : null,
    strongest: ranked.length >= 2 ? ranked[0][0] : null,
    weakest: ranked.length >= 2 ? ranked[ranked.length - 1][0] : null,
    perSubject,
  };
}

/** How many rows an exam has in one of the exam-office tables. */
export async function countFor(table: "exam_seats" | "exam_duties" | "exam_slots", assessmentId: string): Promise<number> {
  const { count, error } = await admin().from(table).select("id", { count: "exact", head: true }).eq("assessment_id", assessmentId);
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return count ?? 0;
}
