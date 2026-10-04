"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertPermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { decodeMessage, type Localized } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { getCurrentClassTeacher } from "@/modules/academics/data/class-teachers-repo";
import {
  canMarkClass,
  submitRegisterSchema,
} from "@/modules/attendance/domain/attendance";
import {
  canDecide,
  canRequestCorrection,
  decideCorrectionSchema,
  requestCorrectionSchema,
} from "@/modules/attendance/domain/corrections";
import { writeNoteSchema } from "@/modules/notes/domain/notes";
import {
  classRoll,
  findRegister,
  listMarks,
  registerById,
  saveRegister,
} from "@/modules/attendance/data/attendance-repo";
import { classScopeFor, ownClassIds } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import {
  decideCorrection,
  getCorrection,
  hasPendingCorrection,
  requestCorrection,
} from "@/modules/attendance/data/corrections-repo";
import { deleteOwnNote, writeNote } from "@/modules/notes/data/notes-repo";
import {
  idleTeachState,
  type TeachState,
} from "@/modules/attendance/domain/teach-state";

function failure(message: Localized): TeachState {
  return { status: "error", message };
}

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Localized {
  const first = error.issues[0];
  return decodeMessage(first?.message ?? "");
}

/* ------------------------------------------------------- attendance */

/**
 * Save or submit a register.
 *
 * Called both by the form and by the browser's offline queue flushing, which
 * is why it takes the whole register rather than one mark: a flush after a
 * signal drop must be one request that either lands or does not, not twenty
 * that might half-land.
 */
export async function saveRegisterAction(
  _previous: TeachState,
  formData: FormData,
): Promise<TeachState> {
  const actor = await assertPermission("attendance:view");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  let payload: unknown;
  try {
    payload = JSON.parse((formData.get("payload") ?? "").toString());
  } catch {
    return failure(m.notSaved);
  }

  const parsed = submitRegisterSchema.safeParse(payload);
  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  if (parsed.data.sessionLabel && parsed.data.sessionLabel !== sessionLabel) return failure(m.noSessionFound);

  const own = await ownClassIds(actor.id, sessionLabel);
  const verdict = canMarkClass({
    hasMarkPermission: can(actor, "attendance:mark"),
    hasMarkOnBehalfPermission: can(actor, "attendance:mark_on_behalf"),
    ownClassIds: own,
    classId: parsed.data.classId,
  });

  if (!verdict.allowed) {
    return failure(verdict.reason ?? m.notSaved);
  }

  // Every mark has to be for a child on this class's roll. The form only
  // offers the roll, but the payload is JSON a browser built, and a register
  // that records a child from another class is a record of something that did
  // not happen (P1).
  const roll = await classRoll({ classId: parsed.data.classId, sessionLabel });
  const onRoll = new Set(roll.map((student) => student.studentId));
  if (parsed.data.marks.some((mark) => !onRoll.has(mark.studentId))) {
    return failure(m.notSaved);
  }

  // A submitted register is a record. Re-saving one is a correction request,
  // not an edit — checked here as well as hidden in the UI.
  const existing = await findRegister(
    parsed.data.classId,
    sessionLabel,
    parsed.data.day,
    parsed.data.period,
  );

  if (existing && existing.status === "submitted") {
    // A lost response may retry the same submission, without editing a record.
    if (parsed.data.submit && existing.takenBy === actor.id) {
      const stored = await listMarks(existing.id);
      if (stored.size === parsed.data.marks.length && new Set(parsed.data.marks.map(mark => mark.studentId)).size === stored.size && parsed.data.marks.every(mark => {
        const found = stored.get(mark.studentId);
        return found?.status === mark.status && (found.note ?? null) === (mark.note ?? null);
      })) return { ...idleTeachState, status: "saved" };
    }
    return failure(m.attendanceLocked);
  }

  // `on_behalf_of` names the teacher the office is standing in for, not the
  // person pressing the button — `taken_by` already says that. Setting it to
  // the actor would make the two columns agree and record nothing, which is
  // the whole fact the column exists to keep.
  let onBehalfOfStaffId: string | null = null;
  if (verdict.onBehalf) {
    const classTeacher = await getCurrentClassTeacher(
      parsed.data.classId,
      sessionLabel,
      "class_teacher",
    );
    onBehalfOfStaffId =
      classTeacher && classTeacher.staffProfileId !== actor.id
        ? classTeacher.staffProfileId
        : null;
  }

  try {
    await saveRegister({
      sessionLabel,
      classId: parsed.data.classId,
      day: parsed.data.day,
      period: parsed.data.period,
      marks: parsed.data.marks,
      submit: parsed.data.submit,
      takenByStaffId: actor.id,
      onBehalfOfStaffId,
      createdByUserId: actor.userId,
    });
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/teach");
  revalidatePath(`/teach/attendance`);
  return { ...idleTeachState, status: "saved" };
}

/* ------------------------------------------------------ corrections */

export async function requestCorrectionAction(
  _previous: TeachState,
  formData: FormData,
): Promise<TeachState> {
  const actor = await assertPermission("attendance:view");

  const parsed = requestCorrectionSchema.safeParse({
    registerId: (formData.get("registerId") ?? "").toString(),
    studentId: (formData.get("studentId") ?? "").toString(),
    toStatus: (formData.get("toStatus") ?? "").toString(),
    reason: (formData.get("reason") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  // The register as it is, read under the actor's own scope: one outside
  // their classes is null, and its status is the real one rather than the
  // "submitted" this action used to assume (P1).
  const register = await registerById(parsed.data.registerId);
  const sessionLabel = await resolveSessionLabel();
  if (!register || !sessionLabel) return failure(m.notSaved);
  const scope = await classScopeFor(actor, sessionLabel);
  if (!scopeIncludes(scope, register.classId)) return failure(m.notYourClassTitle);

  const marks = await listMarks(parsed.data.registerId);
  if (!marks.has(parsed.data.studentId)) return failure(m.notSaved);
  const current = marks.get(parsed.data.studentId)?.status ?? null;
  const pending = await hasPendingCorrection(
    parsed.data.registerId,
    parsed.data.studentId,
  );

  // The register has to be submitted for a correction to make sense — an open
  // one is edited directly.
  const verdict = canRequestCorrection({
    registerStatus: register.status,
    currentStatus: current,
    toStatus: parsed.data.toStatus,
    hasPendingRequest: pending,
  });

  if (!verdict.allowed) return failure(verdict.reason ?? m.notSaved);

  try {
    await requestCorrection({
      registerId: parsed.data.registerId,
      studentId: parsed.data.studentId,
      fromStatus: current,
      toStatus: parsed.data.toStatus,
      reason: parsed.data.reason,
      requestedByStaffId: actor.id,
    });
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/teach/corrections");
  return { ...idleTeachState, status: "saved", message: m.correctionSent };
}

export async function decideCorrectionAction(formData: FormData) {
  const actor = await assertPermission("attendance:correct");

  const parsed = decideCorrectionSchema.safeParse({
    correctionId: (formData.get("correctionId") ?? "").toString(),
    approve: formData.get("approve") === "true",
    decisionNote: (formData.get("decisionNote") ?? "").toString(),
  });

  if (!parsed.success) return;

  const correction = await getCorrection(parsed.data.correctionId);
  if (!correction) return;

  // Nobody approves their own — the point of the queue is a second person.
  const verdict = canDecide({
    hasCorrectPermission: can(actor, "attendance:correct"),
    requestedByStaffId: correction.requestedBy,
    deciderStaffId: actor.id,
    status: correction.status,
  });

  if (!verdict.allowed) {
    throw new Error(verdict.reason?.en ?? "Cannot decide this request.");
  }

  await decideCorrection({
    correctionId: correction.id,
    approve: parsed.data.approve,
    decisionNote: parsed.data.decisionNote,
    deciderStaffId: actor.id,
    registerId: correction.registerId,
    studentId: correction.studentId,
    toStatus: correction.toStatus,
  });

  revalidatePath("/teach/corrections");
}

/* ------------------------------------------------------------ notes */

export async function writeNoteAction(
  _previous: TeachState,
  formData: FormData,
): Promise<TeachState> {
  const actor = await assertPermission("notes:write");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const parsed = writeNoteSchema.safeParse({
    kindId: (formData.get("kindId") ?? "").toString(),
    studentId: (formData.get("studentId") ?? "").toString(),
    classId: (formData.get("classId") ?? "").toString(),
    body: (formData.get("body") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  // A note is about a class or a child the writer teaches (P1). A child is in
  // scope through their enrolment this session, read under the writer's RLS.
  const scope = await classScopeFor(actor, sessionLabel);
  if (parsed.data.classId && !scopeIncludes(scope, parsed.data.classId)) {
    return failure(m.notYourClassTitle);
  }
  if (parsed.data.studentId) {
    const placement = await enrolmentForStudent(parsed.data.studentId, sessionLabel);
    if (!scopeIncludes(scope, placement?.classId)) return failure(m.notYourStudentTitle);
  }

  try {
    await writeNote(parsed.data, sessionLabel, actor.id);
  } catch {
    return failure(m.notSaved);
  }

  if (parsed.data.studentId) revalidatePath(`/teach/student/${parsed.data.studentId}`);
  if (parsed.data.classId) revalidatePath(`/teach/class/${parsed.data.classId}`);

  return { ...idleTeachState, status: "saved", message: m.notesAdded };
}

export async function deleteNoteAction(formData: FormData) {
  const actor = await assertPermission("notes:write");

  const noteId = (formData.get("noteId") ?? "").toString();
  const studentId = (formData.get("studentId") ?? "").toString();
  const classId = (formData.get("classId") ?? "").toString();
  if (!noteId) return;

  // Only your own, enforced in the query itself rather than checked first —
  // a tampered id cannot reach somebody else's note.
  await deleteOwnNote(noteId, actor.id);

  if (studentId) revalidatePath(`/teach/student/${studentId}`);
  if (classId) revalidatePath(`/teach/class/${classId}`);
}
