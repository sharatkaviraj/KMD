import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import {
  attendanceCalendar,
  attendanceRules,
  classRoll,
  studentAttendance,
} from "@/modules/attendance/data/attendance-repo";
import { attendancePercent } from "@/modules/attendance/domain/attendance";
import { isSchoolOpen } from "@/modules/academics/domain/calendar";
import { daysBetween } from "@/modules/assessments/domain/report-period";
import { schoolToday } from "@/platform/dates";
import type { ReportScheme, GradeBandRule } from "@/modules/assessments/domain/report-scheme";
import {
  listAssessments,
  marksForPapers,
  papersForClass,
} from "@/modules/assessments/data/assessments-repo";
import {
  buildReportCard,
  type CardScheme,
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

/* ------------------------------------------------------------ schemes */

type SchemeRow = {
  id: string;
  session_label: string;
  term: string;
  revision: number;
  status: "draft" | "approved";
  grade_bands: GradeBandRule[];
  percent_decimals: number;
  pass_percent: number | string | null;
  attendance_from: string | null;
  attendance_to: string | null;
  header_en: string | null;
  header_hi: string | null;
  signatories: { en: string; hi: string }[];
  approved_at: string | null;
  staff_profiles: { display_name: string } | null;
};

const SCHEME_COLUMNS =
  "id, session_label, term, revision, status, grade_bands, percent_decimals, pass_percent, " +
  "attendance_from, attendance_to, header_en, header_hi, signatories, approved_at, staff_profiles(display_name)";

const toScheme = (row: SchemeRow): ReportScheme => ({
  id: row.id,
  sessionLabel: row.session_label,
  term: row.term,
  revision: row.revision,
  status: row.status,
  gradeBands: row.grade_bands,
  percentDecimals: row.percent_decimals,
  passPercent: row.pass_percent === null ? null : Number(row.pass_percent),
  attendanceFrom: row.attendance_from,
  attendanceTo: row.attendance_to,
  headerEn: row.header_en,
  headerHi: row.header_hi,
  signatories: row.signatories ?? [],
  approvedByName: row.staff_profiles?.display_name ?? null,
  approvedAt: row.approved_at,
});

/** Every revision of a term's scheme, newest first. */
export async function schemesFor(sessionLabel: string, term: string): Promise<ReportScheme[]> {
  await assertPermission("reports:view");
  const { data, error } = await createAdminClient()
    .from("report_schemes")
    .select(SCHEME_COLUMNS)
    .eq("session_label", sessionLabel)
    .eq("term", term)
    .order("revision", { ascending: false })
    .returns<SchemeRow[]>();
  if (error) throw new Error(`Could not read the report scheme: ${error.message}`);
  return data.map(toScheme);
}

/** The scheme cards are issued against: the latest approved revision. */
export function approvedScheme(schemes: ReportScheme[]): ReportScheme | null {
  return schemes.find((scheme) => scheme.status === "approved") ?? null;
}

export function cardSchemeOf(scheme: ReportScheme): CardScheme {
  return {
    id: scheme.id,
    revision: scheme.revision,
    percentDecimals: scheme.percentDecimals,
    passPercent: scheme.passPercent,
    bands: scheme.gradeBands,
    headerEn: scheme.headerEn,
    headerHi: scheme.headerHi,
    signatories: scheme.signatories,
  };
}

/**
 * Write the draft revision of a term's scheme — the one revision that may be
 * edited. The caller has checked `assessments:manage`.
 */
export async function saveSchemeDraft(input: {
  sessionLabel: string;
  term: string;
  gradeBands: GradeBandRule[];
  percentDecimals: number;
  passPercent: number | null;
  attendanceFrom: string | null;
  attendanceTo: string | null;
  headerEn: string | null;
  headerHi: string | null;
  signatories: { en: string; hi: string }[];
}): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("report_schemes")
    .select("id, revision, status")
    .eq("session_label", input.sessionLabel)
    .eq("term", input.term)
    .order("revision", { ascending: false })
    .returns<{ id: string; revision: number; status: string }[]>();
  const draft = (existing ?? []).find((row) => row.status === "draft");
  const values = {
    grade_bands: input.gradeBands,
    percent_decimals: input.percentDecimals,
    pass_percent: input.passPercent,
    attendance_from: input.attendanceFrom,
    attendance_to: input.attendanceTo,
    header_en: input.headerEn,
    header_hi: input.headerHi,
    signatories: input.signatories,
  };
  const { error } = draft
    ? await admin.from("report_schemes").update(values).eq("id", draft.id).eq("status", "draft")
    : await admin.from("report_schemes").insert({
        session_label: input.sessionLabel,
        term: input.term,
        revision: (existing?.[0]?.revision ?? 0) + 1,
        status: "draft",
        ...values,
      });
  if (error) throw new Error(`Could not save the scheme: ${error.message}`);
}

/** Approve the draft. From now on it is a record: cards are issued from it. */
export async function approveSchemeDraft(input: {
  sessionLabel: string;
  term: string;
  actorStaffId: string;
}): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("report_schemes")
    .update({ status: "approved", approved_by: input.actorStaffId, approved_at: new Date().toISOString() })
    .eq("session_label", input.sessionLabel)
    .eq("term", input.term)
    .eq("status", "draft")
    .select("id");
  if (error) throw new Error(`Could not approve the scheme: ${error.message}`);
  return (data ?? []).length > 0;
}

/* ------------------------------------------------------------ the card */

/** What a card was made from: each paper's revision and the attendance period. */
export type CardSources = {
  papers: { id: string; subjectCode: string; entryRevision: number; entryStatus: "open" | "submitted" }[];
  attendance: { from: string | null; to: string | null; recordedDays: number; notRecordedDays: number };
};

/**
 * Build one card from today's marks, against the term's approved scheme when
 * there is one (P8).
 *
 * Not stored by this function. This is the preview a coordinator looks at
 * while papers are still being marked, and it moves as marks arrive; the card
 * a family holds is the issued revision, frozen with what it was made from.
 *
 * Attendance is counted over the scheme's reporting period, on the days the
 * class's register was recorded; the open days it was not are counted
 * separately and never as present.
 */
export async function previewReportCard(input: {
  studentId: string;
  sessionLabel: string;
  term: string;
}): Promise<{ card: ReportCard; sources: CardSources; scheme: ReportScheme | null } | null> {
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

  const [assessments, papers, attendance, rules, schemes, calendar] = await Promise.all([
    listAssessments(input.sessionLabel),
    papersForClass(enrolment.class_id, input.sessionLabel),
    studentAttendance(input.studentId, input.sessionLabel),
    attendanceRules(input.sessionLabel),
    schemesFor(input.sessionLabel, input.term),
    attendanceCalendar(input.sessionLabel),
  ]);
  const scheme = approvedScheme(schemes);

  const inTerm = assessments.filter((entry) => entry.term === input.term && entry.status !== "draft");
  const termIds = new Set(inTerm.map((entry) => entry.id));
  const termPapers = papers.filter((paper) => termIds.has(paper.assessmentId));

  const marks = await marksForPapers(termPapers.map((paper) => paper.id));

  // The reporting period: the scheme's, or the session so far.
  const today = schoolToday();
  const from = scheme?.attendanceFrom ?? null;
  const to = scheme?.attendanceTo && scheme.attendanceTo < today ? scheme.attendanceTo : today;
  const inPeriod = attendance.filter((entry) => (!from || entry.day >= from) && entry.day <= to);
  // The school's half-day rule, the same one the register and the student
  // card use, so a report cannot disagree with them (P6).
  const summary = attendancePercent(inPeriod.map((entry) => entry.status), rules);

  const { data: registers } = await admin
    .from("attendance_registers")
    .select("day")
    .eq("session_label", input.sessionLabel)
    .eq("class_id", enrolment.class_id)
    .is("period", null)
    .gte("revision", 1)
    .gte("day", from ?? "0000-01-01")
    .lte("day", to)
    .returns<{ day: string }[]>();
  const recorded = new Set((registers ?? []).map((row) => row.day));
  const openDays = from ? daysBetween(from, to).filter((day) => isSchoolOpen(day, calendar)) : [...recorded];
  const notRecorded = openDays.filter((day) => !recorded.has(day)).length;

  const card = buildReportCard({
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
      summary.counted === 0 && notRecorded === 0
        ? null
        : {
            present: summary.present,
            counted: summary.counted,
            percent: summary.percent,
            from,
            to,
            notRecorded,
          },
    scheme: scheme ? cardSchemeOf(scheme) : null,
    generatedAt: new Date().toISOString(),
  });

  return {
    card,
    scheme,
    sources: {
      papers: termPapers.map((paper) => ({
        id: paper.id,
        subjectCode: paper.subjectCode,
        entryRevision: paper.entryRevision,
        entryStatus: paper.entryStatus,
      })),
      attendance: { from, to, recordedDays: recorded.size, notRecordedDays: notRecorded },
    },
  };
}

export type IssuedCard = {
  id: string;
  revision: number;
  status: "issued" | "superseded";
  kind: "issue" | "reissue" | "imported";
  card: ReportCard;
  reason: string | null;
  issuedAt: string;
  issuedByName: string | null;
  schemeRevision: number | null;
};

/** Every revision of a child's card for a term, newest first; the first is the current one. */
export async function issuedCards(input: {
  studentId: string;
  sessionLabel: string;
  term: string;
}): Promise<IssuedCard[]> {
  await assertPermission("reports:view");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_card_issues")
    .select("id, revision, status, kind, card, reason, issued_at, staff_profiles(display_name), report_schemes(revision)")
    .eq("session_label", input.sessionLabel)
    .eq("student_id", input.studentId)
    .eq("term", input.term)
    .order("revision", { ascending: false })
    .returns<
      {
        id: string;
        revision: number;
        status: IssuedCard["status"];
        kind: IssuedCard["kind"];
        card: ReportCard;
        reason: string | null;
        issued_at: string;
        staff_profiles: { display_name: string } | null;
        report_schemes: { revision: number } | null;
      }[]
    >();
  if (error) throw new Error(`Could not read the issued cards: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    revision: row.revision,
    status: row.status,
    kind: row.kind,
    card: row.card,
    reason: row.reason,
    issuedAt: row.issued_at,
    issuedByName: row.staff_profiles?.display_name ?? null,
    schemeRevision: row.report_schemes?.revision ?? null,
  }));
}

export type IssueOutcome =
  | { outcome: "issued"; revision: number; kind: "issue" | "reissue"; replayed: boolean }
  | { outcome: "refused"; reason: string; papers: string[] };

/**
 * Issue or reissue one card: one database command (P8).
 *
 * `issue_report_card` checks again that the actor runs the exams, that the
 * scheme is the term's latest approved one, that every paper the class sat
 * has been submitted and none has moved since the card was worked out, that
 * nothing is missing, and the revision the page showed — then supersedes the
 * old revision, if any, and writes the new one, with its reason, in one go.
 */
export async function issueReportCardCommand(input: {
  commandId: string;
  actorStaffId: string;
  sessionLabel: string;
  term: string;
  studentId: string;
  schemeId: string;
  expectedRevision: number;
  reason: string | null;
  card: ReportCard;
  sources: CardSources;
  payloadHash: string;
  fault?: "after_supersede";
}): Promise<IssueOutcome> {
  const { data, error } = await createAdminClient().rpc("issue_report_card", {
    p: {
      command_id: input.commandId,
      actor_staff_id: input.actorStaffId,
      session_label: input.sessionLabel,
      term: input.term,
      student_id: input.studentId,
      scheme_id: input.schemeId,
      expected_revision: input.expectedRevision,
      reason: input.reason,
      card: input.card,
      sources: {
        papers: input.sources.papers.map((paper) => ({ id: paper.id, entry_revision: paper.entryRevision })),
        attendance: input.sources.attendance,
      },
      payload_hash: input.payloadHash,
      fault: input.fault ?? null,
    },
  });
  if (error) throw new Error(`Could not issue the card: ${error.message}`);
  const row = data as Record<string, unknown>;
  if (row.ok === true) {
    return {
      outcome: "issued",
      revision: Number(row.revision),
      kind: row.kind as "issue" | "reissue",
      replayed: Boolean(row.replayed),
    };
  }
  return { outcome: "refused", reason: String(row.reason ?? "failed"), papers: (row.papers as string[]) ?? [] };
}

/** How many cards have been issued for a term, for the board. */
export async function issuedCount(
  sessionLabel: string,
  term: string,
): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("report_card_issues")
    .select("id", { count: "exact", head: true })
    .eq("session_label", sessionLabel)
    .eq("term", term)
    .eq("status", "issued");

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
