"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertPermission, assertStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolToday } from "@/platform/dates";
import { decodeMessage, t, type Localized } from "@/platform/i18n/language";
import {
  classLabelMap,
  listSubjects,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import {
  deleteAssessment,
  deletePaper,
  findMarksCommand,
  getPaper,
  isAssignedTo,
  papersFor,
  rosterForPaper,
  saveMarksCommand,
  setAssessmentStatus,
  upsertAssessment,
  upsertPaper,
} from "@/modules/assessments/data/assessments-repo";
import {
  marksRefusals,
  paperAuthority,
  saveMarksSchema,
  type MarksSaveState,
  type SaveMarksInput,
} from "@/modules/assessments/domain/marks-command";
import {
  issueReportCard,
  logExport,
  previewReportCard,
} from "@/modules/assessments/data/reports-repo";
import {
  assessmentSchema,
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
    markStep: (formData.get("markStep") ?? "0.5").toString(),
    allowExempt: formData.get("allowExempt") === "on" || formData.get("allowExempt") === "true",
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  // A paper whose marks are being typed keeps the scheme they are typed
  // against: changing the maximum or the step under somebody's draft would
  // make marks already entered wrong without anybody touching them (P7).
  const same = (await papersFor(parsed.data.assessmentId)).find(
    (paper) => paper.classId === parsed.data.classId && paper.subjectId === parsed.data.subjectId,
  );
  if (
    same &&
    same.entryRevision > 0 &&
    (same.maxMarks !== parsed.data.maxMarks ||
      same.markStep !== parsed.data.markStep ||
      (same.allowExempt && !parsed.data.allowExempt))
  ) {
    return failure(m.paperSchemeInUse);
  }

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

/** What a repeated submission must match: the column as the person saved it. */
function marksPayloadHash(input: SaveMarksInput): string {
  const entries = [...input.entries].sort((a, b) => a.studentId.localeCompare(b.studentId));
  return createHash("sha256")
    .update(
      JSON.stringify({
        paperId: input.paperId,
        kind: input.kind,
        expectedRevision: input.expectedRevision,
        reason: input.reason,
        entries: entries.map((entry) => [entry.studentId, entry.state, entry.state === "value" ? entry.value : null]),
      }),
    )
    .digest("hex");
}

/**
 * Save one paper's marks: a draft, a submission, a correction or a reopening
 * (P7).
 *
 * The browser sends the whole column as the person sees it, the revision the
 * page showed and a submission id minted once. This decides who may act in
 * words they will read; `save_marks` decides everything again inside the
 * transaction that writes, and a refusal there leaves the column untouched.
 */
export async function saveMarksAction(
  _previous: MarksSaveState,
  formData: FormData,
): Promise<MarksSaveState> {
  const actor = await assertPermission("marks:view");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { status: "refused", message: m.noSessionFound };

  let payload: unknown;
  try {
    payload = JSON.parse((formData.get("payload") ?? "").toString());
  } catch {
    return { status: "refused", message: marksRefusals.bad_request };
  }
  const parsed = saveMarksSchema.safeParse(payload);
  if (!parsed.success) return { status: "refused", message: fieldErrorsFrom(parsed.error) };

  const paper = await getPaper(parsed.data.paperId);
  if (!paper) return { status: "refused", message: marksRefusals.not_found };

  const authority = paperAuthority({
    isManager: can(actor, "assessments:manage"),
    isAssigned: await isAssignedTo({
      staffProfileId: actor.id,
      sessionLabel,
      classId: paper.classId,
      subjectId: paper.subjectId,
    }),
    hasWritePermission: can(actor, "marks:write"),
  });
  const allowed = parsed.data.kind === "reopen" ? authority.reopen : authority.enter;
  if (!allowed) return { status: "refused", message: authority.reason ?? marksRefusals.not_permitted };

  let outcome;
  try {
    outcome = await saveMarksCommand({
      ...parsed.data,
      actorStaffId: actor.id,
      payloadHash: marksPayloadHash(parsed.data),
    });
  } catch {
    return { status: "error", message: marksRefusals.failed };
  }

  if (outcome.outcome === "saved") {
    revalidatePath(`/assessments/${paper.assessmentId}`);
    revalidatePath(`/assessments/marks/${paper.id}`);
    return { status: "saved", receipt: outcome.receipt };
  }
  if (outcome.outcome === "stale") return { status: "stale", message: marksRefusals.stale };

  if (outcome.outcome === "incomplete" || outcome.outcome === "invalid") {
    // Names, not ids: "Asha and Ravi are still blank" is what a teacher can act on.
    const roll = await rosterForPaper(paper.id);
    const nameOf = new Map(roll.map((student) => [student.studentId, student.fullName]));
    if (outcome.outcome === "incomplete") {
      return {
        status: "incomplete",
        blank: outcome.blank.map((id) => nameOf.get(id) ?? "—"),
        message: marksRefusals.incomplete,
      };
    }
    return {
      status: "invalid",
      who: outcome.studentId ? (nameOf.get(outcome.studentId) ?? null) : null,
      message: marksRefusals[outcome.reason] ?? marksRefusals.failed,
    };
  }

  return { status: "refused", message: marksRefusals[outcome.reason] ?? marksRefusals.failed };
}

/** Did the save with this id land? Asked when an answer never arrived. */
export async function checkMarksSaveAction(commandId: string): Promise<MarksSaveState> {
  const actor = await assertStaff();
  if (!/^[0-9a-f-]{36}$/i.test(commandId)) return { status: "error", message: marksRefusals.failed };
  const receipt = await findMarksCommand(commandId, actor.id);
  return receipt ? { status: "saved", receipt } : { status: "error", message: marksRefusals.failed };
}

/* --------------------------------------------------- the report card */

export async function issueReportCardAction(
  _previous: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  // Issuing writes a frozen record; reading one is `reports:view`, issuing it
  // is the exam coordinator's and the administrator's (D-206).
  const actor = await assertPermission("assessments:manage");

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
