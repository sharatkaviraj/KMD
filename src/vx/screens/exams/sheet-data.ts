import "server-only";

import { schoolToday } from "@/platform/dates";
import { createAdminClient } from "@/platform/supabase/admin";
import { shortDay } from "@/vx/format";

import { listExams, marksOf, paperById, previousExam, studentsByIds, toCell, type Exam, type PaperRow } from "./data";
import type { Cell } from "./domain/entry";

/*
 * Everything one marks sheet needs, for whoever has already been allowed to
 * open it: the paper, its roll in roll order, what is saved, and each child's
 * mark in the exam before, shown faintly beside the box.
 */

export type SheetStudent = { id: string; name: string; roll: string | null; prev: string | null; prevPct: number | null };

export type SheetPaper = {
  id: string;
  examId: string;
  examLabel: { en: string; hi: string };
  classId: string;
  classLabel: string;
  subjectCode: string;
  subjectId: string;
  maxMarks: number;
  passMarks: number | null;
  markStep: number;
  allowExempt: boolean;
  entryStatus: "open" | "submitted";
  entryRevision: number;
  submittedAt: string | null;
  submittedBy: string | null;
  examOpen: boolean;
  locked: boolean;
  dueLabel: string | null;
};

export type Sheet = {
  paper: SheetPaper;
  students: SheetStudent[];
  saved: Record<string, Cell>;
  coordinatorName: string | null;
};

async function rosterIds(paperId: string): Promise<string[]> {
  const { data, error } = await createAdminClient().rpc("paper_roster", { p_paper: paperId });
  if (error) throw new Error(`Could not read who sat the paper: ${error.message}`);
  return ((data ?? []) as string[]).filter(Boolean);
}

function rollOrder(a: SheetStudent, b: SheetStudent): number {
  const ra = Number(a.roll ?? NaN);
  const rb = Number(b.roll ?? NaN);
  if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
  if (Number.isFinite(ra) !== Number.isFinite(rb)) return Number.isFinite(ra) ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export async function loadSheet(paperId: string, known?: { exams?: Exam[]; paper?: PaperRow }): Promise<Sheet | null> {
  const paper = known?.paper ?? (await paperById(paperId));
  if (!paper) return null;
  const db = createAdminClient();
  const { data: exam } = await db
    .from("assessments")
    .select("id, session_label, label_en, label_hi, code, status")
    .eq("id", paper.assessment_id)
    .maybeSingle<{ id: string; session_label: string; label_en: string; label_hi: string; code: string; status: string }>();
  if (!exam) return null;

  const exams = known?.exams ?? (await listExams(exam.session_label));
  const self = exams.find((e) => e.id === exam.id);
  const before = self ? previousExam(exams, self) : null;

  const [ids, marks, lock, coordinator, prevPaper] = await Promise.all([
    rosterIds(paper.id),
    marksOf([paper.id]),
    db.from("exam_class_locks").select("class_id").eq("assessment_id", paper.assessment_id).eq("class_id", paper.class_id).maybeSingle(),
    db
      .from("staff_profiles")
      .select("display_name")
      .eq("role", "exam_coordinator")
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle<{ display_name: string }>(),
    before
      ? db
          .from("assessment_subjects")
          .select("id, max_marks")
          .eq("assessment_id", before.id)
          .eq("class_id", paper.class_id)
          .eq("subject_id", paper.subject_id)
          .maybeSingle<{ id: string; max_marks: number | string }>()
      : Promise.resolve({ data: null }),
  ]);

  const [names, rolls, prevMarks] = await Promise.all([
    studentsByIds(ids),
    ids.length
      ? db
          .from("enrolments")
          .select("student_id, roll_no")
          .eq("session_label", exam.session_label)
          .eq("class_id", paper.class_id)
          .returns<{ student_id: string; roll_no: string | null }[]>()
      : Promise.resolve({ data: [] as { student_id: string; roll_no: string | null }[] }),
    prevPaper.data ? marksOf([prevPaper.data.id]) : Promise.resolve([]),
  ]);

  const rollOf = new Map((rolls.data ?? []).map((r) => [r.student_id, r.roll_no]));
  const prevMax = prevPaper.data ? Number(prevPaper.data.max_marks) : 0;
  const prevOf = new Map(prevMarks.map((m) => [m.student_id, m]));
  const students: SheetStudent[] = ids
    .map((id) => {
      const pm = prevOf.get(id);
      const prevValue = pm && pm.value !== null && !pm.absent ? Number(pm.value) : null;
      return {
        id,
        name: names.get(id)?.name ?? "—",
        roll: rollOf.get(id) ?? null,
        prev: before && pm ? `${before.code}: ${pm.absent ? "AB" : pm.exempt ? "EX" : `${prevValue ?? "—"}/${prevMax}`}` : null,
        prevPct: prevValue !== null && prevMax > 0 ? Math.round((prevValue / prevMax) * 100) : null,
      };
    })
    .sort(rollOrder);

  const markOf = new Map(marks.map((m) => [m.student_id, m]));
  const saved: Record<string, Cell> = {};
  for (const s of students) saved[s.id] = toCell(markOf.get(s.id));

  const due = self?.plan?.marksDueOn ?? null;
  return {
    paper: {
      id: paper.id,
      examId: paper.assessment_id,
      examLabel: { en: exam.label_en, hi: exam.label_hi },
      classId: paper.class_id,
      classLabel: paper.class_label,
      subjectCode: paper.subject_code,
      subjectId: paper.subject_id,
      maxMarks: Number(paper.max_marks),
      passMarks: paper.pass_marks === null ? null : Number(paper.pass_marks),
      markStep: Number(paper.mark_step),
      allowExempt: paper.allow_exempt,
      entryStatus: paper.entry_status,
      entryRevision: paper.entry_revision,
      submittedAt: paper.submitted_at,
      submittedBy: paper.submitted_by,
      examOpen: exam.status === "open",
      locked: Boolean(lock.data),
      dueLabel: due ? shortDay(due) : null,
    },
    students,
    saved,
    coordinatorName: coordinator.data?.display_name ?? null,
  };
}

/** Days left until marks are due, for the banner; negative once overdue. */
export function daysLeft(due: string | null, today = schoolToday()): number | null {
  if (!due) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
