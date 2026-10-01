"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertPermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolToday } from "@/platform/dates";
import { decodeMessage, t, type Localized } from "@/platform/i18n/language";
import {
  classLabelMap,
  listSubjects,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { ownClassIds } from "@/modules/attendance/data/teaching-repo";
import {
  deleteAssessment,
  deletePaper,
  getAssessment,
  getPaper,
  saveMark,
  setAssessmentStatus,
  upsertAssessment,
  upsertPaper,
} from "@/modules/assessments/data/assessments-repo";
import {
  issueReportCard,
  logExport,
  previewReportCard,
} from "@/modules/assessments/data/reports-repo";
import {
  assessmentSchema,
  canEnterMarks,
  checkMark,
  paperSchema,
  type AssessmentStatus,
} from "@/modules/assessments/domain/assessments";
import {
  idleAssessmentState,
  type AssessmentState,
} from "@/modules/assessments/domain/form-state";

function failure(message: Localized): AssessmentState {
  return { status: "error", message };
}

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Localized {
  return decodeMessage(error.issues[0]?.message ?? "");
}

/* --------------------------------------------------------- the exam */

export async function saveAssessmentAction(
  _previous: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  const actor = await assertPermission("assessments:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const parsed = assessmentSchema.safeParse({
    term: (formData.get("term") ?? "").toString(),
    code: (formData.get("code") ?? "").toString(),
    labelHi: (formData.get("labelHi") ?? "").toString(),
    labelEn: (formData.get("labelEn") ?? "").toString(),
    kind: (formData.get("kind") ?? "summative").toString(),
    startsOn: (formData.get("startsOn") ?? "").toString(),
    endsOn: (formData.get("endsOn") ?? "").toString(),
    weight: (formData.get("weight") ?? "1").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  try {
    await upsertAssessment(parsed.data, sessionLabel, actor.userId);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/assessments");
  return { ...idleAssessmentState, status: "saved" };
}

export async function setAssessmentStatusAction(formData: FormData) {
  const actor = await assertPermission("assessments:manage");

  const id = (formData.get("id") ?? "").toString();
  const status = (formData.get("status") ?? "").toString() as AssessmentStatus;
  if (!id || !["draft", "open", "locked"].includes(status)) return;

  await setAssessmentStatus(id, status, actor.id);
  revalidatePath("/assessments");
  revalidatePath(`/assessments/${id}`);
}

export async function deleteAssessmentAction(formData: FormData) {
  await assertPermission("assessments:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  // Only a draft, enforced in the query: an exam anybody has entered a mark
  // against is history, and the cascade would take the change log with it.
  await deleteAssessment(id);
  revalidatePath("/assessments");
}

/* -------------------------------------------------------- the papers */

export async function savePaperAction(
  _previous: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  await assertPermission("assessments:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const passRaw = (formData.get("passMarks") ?? "").toString().trim();

  const parsed = paperSchema.safeParse({
    assessmentId: (formData.get("assessmentId") ?? "").toString(),
    classId: (formData.get("classId") ?? "").toString(),
    subjectId: (formData.get("subjectId") ?? "").toString(),
    maxMarks: (formData.get("maxMarks") ?? "").toString(),
    passMarks: passRaw === "" ? null : passRaw,
    sortOrder: (formData.get("sortOrder") ?? "0").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  if (
    parsed.data.passMarks !== null &&
    parsed.data.passMarks > parsed.data.maxMarks
  ) {
    return failure(
      t(
        "उत्तीर्ण अंक पूर्णांक से अधिक नहीं हो सकते।",
        "A pass mark cannot be higher than what the paper is out of.",
      ),
    );
  }

  const [labels, subjects] = await Promise.all([
    classLabelMap(sessionLabel),
    listSubjects(),
  ]);

  const classLabel = labels.get(parsed.data.classId);
  const subject = subjects.find((entry) => entry.id === parsed.data.subjectId);
  if (!classLabel || !subject) return failure(m.notSaved);

  try {
    await upsertPaper(parsed.data, classLabel, subject.code);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath(`/assessments/${parsed.data.assessmentId}`);
  return { ...idleAssessmentState, status: "saved" };
}

export async function deletePaperAction(formData: FormData) {
  await assertPermission("assessments:manage");

  const id = (formData.get("id") ?? "").toString();
  const assessmentId = (formData.get("assessmentId") ?? "").toString();
  if (!id) return;

  await deletePaper(id);
  if (assessmentId) revalidatePath(`/assessments/${assessmentId}`);
}

/* ---------------------------------------------------------- the grid */

/**
 * Save a column of the grid.
 *
 * The whole paper in one request, like the attendance register and for the
 * same reason: a teacher entering forty marks on a bad connection must not end
 * up with half a column saved.
 *
 * Three checks, in this order, because each one makes the next one meaningful:
 * the exam must be open, the paper must be one this person may mark, and every
 * value must be a mark that can exist. Anything refused leaves the whole column
 * unwritten — a partially-accepted column is the state nobody can reason about.
 */
export async function saveMarksAction(
  _previous: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  const actor = await assertPermission("marks:write");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const loadedSession = formData.get("sessionLabel");
  if (loadedSession && loadedSession !== sessionLabel) return failure(m.noSessionFound);

  const paperId = (formData.get("paperId") ?? "").toString();
  const reason = (formData.get("reason") ?? "").toString().trim() || null;

  const paper = await getPaper(paperId);
  if (!paper) return failure(m.notSaved);

  const assessment = await getAssessment(paper.assessmentId);
  if (!assessment) return failure(m.notSaved);

  const allowed = canEnterMarks(assessment);
  if (!allowed.allowed) return failure(allowed.reason ?? m.notSaved);

  // `marks:write` says a teacher may enter marks; it does not say *whose*.
  // This is the row-level half, the same shape as `canMarkClass()` for
  // attendance: their own classes, unless they are somebody whose job is
  // every class.
  if (!can(actor, "assessments:manage")) {
    const own = await ownClassIds(actor.id, sessionLabel);
    if (!own.includes(paper.classId)) {
      return failure(m.attendanceNotYours);
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse((formData.get("payload") ?? "[]").toString());
  } catch {
    return failure(m.notSaved);
  }

  if (!Array.isArray(payload)) return failure(m.notSaved);

  const writes: { studentId: string; value: number | null; absent: boolean }[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const { studentId, value, absent } = entry as {
      studentId?: unknown;
      value?: unknown;
      absent?: unknown;
    };

    if (typeof studentId !== "string") continue;

    const away = absent === true;
    const checked = checkMark(away ? "" : (value as string), paper);

    if (!checked.ok) return failure(checked.error);

    writes.push({ studentId, value: away ? null : checked.value, absent: away });
  }

  let changed = 0;

  try {
    for (const write of writes) {
      const result = await saveMark({
        assessmentSubjectId: paper.id,
        mark: write,
        staffProfileId: actor.id,
        reason,
      });
      if (result.changed) changed += 1;
    }
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath(`/assessments/${paper.assessmentId}`);
  revalidatePath(`/assessments/marks/${paper.id}`);

  return {
    ...idleAssessmentState,
    status: "saved",
    changed,
    message: t(
      `${changed} अंक बदले।`,
      `${changed} mark${changed === 1 ? "" : "s"} changed.`,
    ),
  };
}

/* --------------------------------------------------- the report card */

export async function issueReportCardAction(
  _previous: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  const actor = await assertPermission("reports:view");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const studentId = (formData.get("studentId") ?? "").toString();
  const term = (formData.get("term") ?? "").toString();
  if (!studentId || !term) return failure(m.notSaved);

  const card = await previewReportCard({ studentId, sessionLabel, term });
  if (!card) return failure(m.notFound);

  try {
    await issueReportCard(card, actor.id);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath(`/assessments/report/${studentId}`);
  return { ...idleAssessmentState, status: "saved", message: m.reportIssued };
}

/* ------------------------------------------------------- the exports */

/**
 * Record that an export was taken.
 *
 * The file itself is built and downloaded in the browser from data already on
 * the page — there is no second query, and nothing is served from a URL that
 * could be shared. What reaches the server is this: who took what, and when,
 * which is the whole reason PLAN 6.5 says "logged".
 */
export async function logExportAction(formData: FormData) {
  const actor = await assertPermission("reports:view");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return;

  const kind = (formData.get("kind") ?? "").toString();
  const scope = (formData.get("scope") ?? "").toString();
  const rowCount = Number((formData.get("rowCount") ?? "0").toString());

  if (!["marks", "attendance", "report_cards"].includes(kind)) return;

  await logExport({
    sessionLabel,
    kind: kind as "marks" | "attendance" | "report_cards",
    scope: scope.slice(0, 200) || schoolToday(),
    rowCount: Number.isFinite(rowCount) ? rowCount : 0,
    staffProfileId: actor.id,
  });

  revalidatePath("/assessments/exports");
}
