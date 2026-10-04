import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { attendanceRules, classRoll, studentAttendance } from "@/modules/attendance/data/attendance-repo";
import { attendancePercent } from "@/modules/attendance/domain/attendance";
import {
  listAssessments,
  marksForPapers,
  papersForClass,
} from "@/modules/assessments/data/assessments-repo";
import {
  buildReportCard,
  type ReportCard,
} from "@/modules/assessments/domain/report-card";
import {
  gradeFor,
  totalsFor,
} from "@/modules/assessments/domain/assessments";
import type { ExportKind } from "@/modules/assessments/domain/exports";

/**
 * Report cards, and the log of what has left the building.
 */

/**
 * Build one card from today's marks.
 *
 * Not stored by this function — see `issueReportCard()`. The difference
 * matters: this is the preview a coordinator looks at while papers are still
 * being marked, and it moves as marks arrive. A card that has been *issued* is
 * frozen, because it is what a family is holding.
 */
export async function previewReportCard(input: {
  studentId: string;
  sessionLabel: string;
  term: string;
}): Promise<ReportCard | null> {
  await assertPermission("reports:view");

  const admin = createAdminClient();

  const { data: student } = await admin
    .schema(FEE_SCHEMA)
    .from("students")
    .select("id, full_name, admission_no, father_name")
    .eq("id", input.studentId)
    .maybeSingle<{
      id: string;
      full_name: string;
      admission_no: string | null;
      father_name: string | null;
    }>();

  if (!student) return null;

  const { data: enrolment } = await admin
    .from("enrolments")
    .select("class_id, roll_no")
    .eq("student_id", input.studentId)
    .eq("session_label", input.sessionLabel)
    .maybeSingle<{ class_id: string; roll_no: string | null }>();

  if (!enrolment) return null;

  const [assessments, papers, attendance, rules] = await Promise.all([
    listAssessments(input.sessionLabel),
    papersForClass(enrolment.class_id, input.sessionLabel),
    studentAttendance(input.studentId, input.sessionLabel),
    attendanceRules(input.sessionLabel),
  ]);

  const inTerm = assessments.filter((entry) => entry.term === input.term);
  const termIds = new Set(inTerm.map((entry) => entry.id));
  const termPapers = papers.filter((paper) => termIds.has(paper.assessmentId));

  const marks = await marksForPapers(termPapers.map((paper) => paper.id));
  // The school's half-day rule, the same one the register and the student
  // card use, so a report cannot disagree with them (P6).
  const summary = attendancePercent(attendance.map((entry) => entry.status), rules);

  return buildReportCard({
    sessionLabel: input.sessionLabel,
    term: input.term,
    student: {
      id: student.id,
      fullName: student.full_name,
      admissionNo: student.admission_no,
      rollNo: enrolment.roll_no,
      classLabel: termPapers[0]?.classLabel ?? "",
      fatherName: student.father_name,
    },
    assessments: inTerm,
    papers: termPapers,
    marks,
    attendance:
      summary.counted === 0
        ? null
        : {
            present: summary.present,
            counted: summary.counted,
            percent: summary.percent,
          },
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Freeze a card.
 *
 * Upserted on (session, student, term): re-issuing replaces, because a school
 * that reprints after a correction means the new one. The old numbers are not
 * lost — every change that produced them is in `marks_change_log`, which is
 * the record that is supposed to carry that weight.
 */
export async function issueReportCard(
  card: ReportCard,
  staffProfileId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("report_cards")
    .upsert(
      {
        session_label: card.sessionLabel,
        student_id: card.studentId,
        term: card.term,
        payload: card,
        generated_by: staffProfileId,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "session_label,student_id,term" },
    );

  if (error) throw error;
}

/** The card as it was issued, or null when none has been. */
export async function issuedReportCard(input: {
  studentId: string;
  sessionLabel: string;
  term: string;
}): Promise<{ card: ReportCard; generatedAt: string; generatedByName: string | null } | null> {
  await assertPermission("reports:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_cards")
    .select("payload, generated_at, staff_profiles(display_name)")
    .eq("session_label", input.sessionLabel)
    .eq("student_id", input.studentId)
    .eq("term", input.term)
    .maybeSingle<{
      payload: ReportCard;
      generated_at: string;
      staff_profiles: { display_name: string } | null;
    }>();

  if (error) throw new Error(`Could not read that report card: ${error.message}`);
  if (!data) return null;

  return {
    card: data.payload,
    generatedAt: data.generated_at,
    generatedByName: data.staff_profiles?.display_name ?? null,
  };
}

/** How many cards have been issued for a term, for the board. */
export async function issuedCount(
  sessionLabel: string,
  term: string,
): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("report_cards")
    .select("id", { count: "exact", head: true })
    .eq("session_label", sessionLabel)
    .eq("term", term);

  if (error) throw new Error(`Could not count the report cards: ${error.message}`);
  return count ?? 0;
}

/** The class roll, for a term's worth of cards. */
export async function rollForClass(classId: string, sessionLabel: string) {
  return classRoll({ classId, sessionLabel });
}

/* -------------------------------------------------------------- the log */

export type ExportEntry = {
  id: string;
  kind: ExportKind;
  scope: string;
  rowCount: number;
  exportedByName: string | null;
  exportedAt: string;
};

/**
 * Write the log row.
 *
 * Called *before* the file is handed over rather than after: a log that only
 * records successful downloads is a log that misses the interesting case, and
 * an export the office started is the fact worth keeping either way.
 */
export async function logExport(input: {
  sessionLabel: string;
  kind: ExportKind;
  scope: string;
  rowCount: number;
  staffProfileId: string;
}): Promise<void> {
  const { error } = await createAdminClient().from("academic_exports").insert({
    session_label: input.sessionLabel,
    kind: input.kind,
    scope: input.scope,
    row_count: input.rowCount,
    exported_by: input.staffProfileId,
  });

  if (error) throw error;
}

export async function recentExports(sessionLabel: string): Promise<ExportEntry[]> {
  await assertPermission("reports:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academic_exports")
    .select("id, kind, scope, row_count, exported_at, staff_profiles(display_name)")
    .eq("session_label", sessionLabel)
    .order("exported_at", { ascending: false })
    .limit(50)
    .returns<
      {
        id: string;
        kind: ExportKind;
        scope: string;
        row_count: number;
        exported_at: string;
        staff_profiles: { display_name: string } | null;
      }[]
    >();

  if (error) throw new Error(`Could not read the export log: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    rowCount: row.row_count,
    exportedByName: row.staff_profiles?.display_name ?? null,
    exportedAt: row.exported_at,
  }));
}

export type TermSummary = {
  term: string;
  totals: ReturnType<typeof totalsFor>;
  grade: string | null;
};

/**
 * How a child is doing, one row per term.
 *
 * For the student card, so it can say so without making anybody open a report
 * to find out. It uses the same `totalsFor()` the report card does, which is
 * the point: two screens showing the same child must not be able to disagree
 * about what a missing paper means.
 */
export async function termSummaries(
  studentId: string,
  sessionLabel: string,
): Promise<TermSummary[]> {
  await assertPermission("marks:view");

  const admin = createAdminClient();

  const { data: enrolment } = await admin
    .from("enrolments")
    .select("class_id")
    .eq("student_id", studentId)
    .eq("session_label", sessionLabel)
    .maybeSingle<{ class_id: string }>();

  if (!enrolment) return [];

  const [assessments, papers] = await Promise.all([
    listAssessments(sessionLabel),
    papersForClass(enrolment.class_id, sessionLabel),
  ]);

  if (papers.length === 0) return [];

  const marks = await marksForPapers(papers.map((paper) => paper.id));
  const termOf = new Map(assessments.map((entry) => [entry.id, entry.term]));
  const weightOf = new Map(assessments.map((entry) => [entry.id, entry.weight]));

  const byTerm = new Map<string, typeof papers>();
  for (const paper of papers) {
    const term = termOf.get(paper.assessmentId);
    if (!term) continue;
    byTerm.set(term, [...(byTerm.get(term) ?? []), paper]);
  }

  return [...byTerm.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en"))
    .map(([term, termPapers]) => {
      const totals = totalsFor(
        termPapers.map((paper) => ({
          paper,
          mark: marks.get(`${paper.id}|${studentId}`),
          weight: weightOf.get(paper.assessmentId) ?? 1,
        })),
      );

      return { term, totals, grade: gradeFor(totals.percent)?.label ?? null };
    });
}
