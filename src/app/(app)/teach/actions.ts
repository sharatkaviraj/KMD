"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertPermission, assertStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { decodeMessage, type Localized } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import {
  registerAuthority,
  saveRegisterSchema,
  type SaveRegisterInput,
} from "@/modules/attendance/domain/attendance";
import {
  attendanceRefusals,
  type AttendanceSaveState,
} from "@/modules/attendance/domain/attendance-receipt";
import {
  canDecide,
  canRequestCorrection,
  decideCorrectionSchema,
  requestCorrectionSchema,
} from "@/modules/attendance/domain/corrections";
import { writeNoteSchema } from "@/modules/notes/domain/notes";
import {
  findAttendanceCommand,
  findRegister,
  listMarks,
  registerById,
  saveRegisterCommand,
  studentNames,
} from "@/modules/attendance/data/attendance-repo";
import { classScopeFor, heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import {
  getCorrection,
  hasPendingCorrection,
  rejectCorrection,
  requestCorrection,
} from "@/modules/attendance/data/corrections-repo";
import { deleteOwnNote, writeNote } from "@/modules/notes/data/notes-repo";
import {
  idleTeachState,
  type TeachState,
} from "@/modules/attendance/domain/teach-state";
import { assertNotPreviewing } from "@/vx/view-as";
import { changeWindow } from "@/vx/screens/teach/domain/teach";

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

/** What a repeated submission must match: the register as the person saved it. */
function payloadHash(input: SaveRegisterInput): string {
  const marks = [...input.marks].sort((a, b) => a.studentId.localeCompare(b.studentId));
  return createHash("sha256")
    .update(
      JSON.stringify({
        classId: input.classId,
        day: input.day,
        kind: input.kind,
        expectedRevision: input.expectedRevision,
        reason: input.reason,
        marks: marks.map((mark) => [mark.studentId, mark.status]),
      }),
    )
    .digest("hex");
}

/**
 * Save or correct one class's daily register (P6).
 *
 * The browser sends the whole roll as the person reviewed it, with the
 * revision the page showed and a submission id minted once per save. This
 * checks the parts only the app can (who may act, in words they will read)
 * and leaves the rest to `save_attendance_register`, which checks it all
 * again inside the transaction that writes.
 */
export async function saveAttendanceAction(
  _previous: AttendanceSaveState,
  formData: FormData,
): Promise<AttendanceSaveState> {
  const actor = await assertPermission("attendance:view");
  await assertNotPreviewing();

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { status: "refused", message: m.noSessionFound };

  let payload: unknown;
  try {
    payload = JSON.parse((formData.get("payload") ?? "").toString());
  } catch {
    return { status: "refused", message: attendanceRefusals.bad_request };
  }

  const parsed = saveRegisterSchema.safeParse(payload);
  if (!parsed.success) return { status: "refused", message: fieldErrorsFrom(parsed.error) };

  const held = await heldClassIds(actor.id, sessionLabel);
  const authority = registerAuthority({
    isOwner: held.includes(parsed.data.classId),
    hasMarkPermission: can(actor, "attendance:mark"),
    hasMarkOnBehalfPermission: can(actor, "attendance:mark_on_behalf"),
    hasCorrectPermission: can(actor, "attendance:correct"),
  });
  const allowed = parsed.data.kind === "save" ? authority.save : authority.correct;
  if (!allowed) return { status: "refused", message: authority.reason ?? attendanceRefusals.not_permitted };

  // Every caller shares the owner window, including direct/legacy actions.
  if (parsed.data.kind === "correction" && !can(actor, "attendance:correct")) {
    const register = await findRegister(parsed.data.classId, sessionLabel, parsed.data.day, null);
    if (!changeWindow(register?.submittedAt ?? null, new Date()).open) {
      return { status: "refused", message: {
        en: "The 30 minutes to change it yourself are over. Ask the office to change it.",
        hi: "खुद बदलने के 30 मिनट पूरे हो गए। बदलाव के लिए ऑफ़िस से कहें।",
      } };
    }
  }

  let outcome;
  try {
    outcome = await saveRegisterCommand({
      ...parsed.data,
      sessionLabel,
      actorStaffId: actor.id,
      payloadHash: payloadHash(parsed.data),
    });
  } catch {
    return { status: "error", message: attendanceRefusals.failed };
  }

  if (outcome.outcome === "saved") {
    revalidatePath("/teach");
    revalidatePath("/teach/attendance");
    return { status: "saved", receipt: outcome.receipt };
  }

  if (outcome.outcome === "stale") {
    return { status: "stale", latest: outcome.latest, message: attendanceRefusals.stale };
  }

  if (outcome.outcome === "roster_changed") {
    // Names, not ids: "Asha joined, Ravi left" is what lets a teacher check.
    const nameOf = await studentNames([...outcome.missing, ...outcome.extra]);
    return {
      status: "roster_changed",
      joined: outcome.missing.map((id) => nameOf.get(id) ?? "—"),
      left: outcome.extra.map((id) => nameOf.get(id) ?? "—"),
      message: attendanceRefusals.roster_changed,
    };
  }

  return { status: "refused", message: attendanceRefusals[outcome.reason] ?? attendanceRefusals.failed };
}

/**
 * Did the save with this submission id land? Asked by the screen when an
 * answer never arrived, before it offers to send again. Only the asker's own
 * submissions are found.
 */
export async function checkAttendanceSaveAction(commandId: string): Promise<AttendanceSaveState> {
  const actor = await assertStaff();
  if (!/^[0-9a-f-]{36}$/i.test(commandId)) return { status: "error", message: attendanceRefusals.failed };
  const receipt = await findAttendanceCommand(commandId, actor.id);
  return receipt ? { status: "saved", receipt } : { status: "error", message: attendanceRefusals.failed };
}

/* ------------------------------------------------------ corrections */

export async function requestCorrectionAction(
  _previous: TeachState,
  formData: FormData,
): Promise<TeachState> {
  const actor = await assertPermission("attendance:view");
  await assertNotPreviewing();

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
  await assertNotPreviewing();

  const parsed = decideCorrectionSchema.safeParse({
    correctionId: (formData.get("correctionId") ?? "").toString(),
    approve: formData.get("approve") === "true",
    decisionNote: (formData.get("decisionNote") ?? "").toString(),
  });

  // Thrown rather than returned: the inbox reports success when this returns.
  if (!parsed.success) throw new Error("Choose a correction request.");

  const correction = await getCorrection(parsed.data.correctionId);
  if (!correction) throw new Error("That request is no longer waiting. Someone may have decided it already.");

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

  if (!parsed.data.approve) {
    await rejectCorrection({
      correctionId: correction.id,
      decisionNote: parsed.data.decisionNote,
      deciderStaffId: actor.id,
    });
    revalidatePath("/teach/corrections");
    return;
  }

  // Approving is a correction of the whole register, with the request's own
  // reason, made by the person approving — so the register's history says
  // who changed it and why, and the request closes in the same transaction
  // (P6). The rest of the register is carried over exactly as it stands.
  const register = await registerById(correction.registerId);
  const sessionLabel = await resolveSessionLabel();
  if (!register || !sessionLabel || register.sessionLabel !== sessionLabel) {
    throw new Error("That register is not in the current session.");
  }
  const marks = await listMarks(register.id);
  // The requester asked to replace one particular mark, not an intervening
  // correction. A later race is still refused by expectedRevision in the RPC.
  if (!marks.has(correction.studentId) || marks.get(correction.studentId)?.status !== correction.fromStatus) {
    throw new Error("The requested mark has changed. Review the latest register before deciding.");
  }
  const input: SaveRegisterInput = {
    commandId: randomUUID(),
    classId: register.classId,
    day: register.day,
    kind: "correction",
    expectedRevision: register.revision,
    reason: correction.reason,
    marks: [...marks.entries()].map(([studentId, mark]) => ({
      studentId,
      status: studentId === correction.studentId ? correction.toStatus : mark.status,
    })),
  };

  const outcome = await saveRegisterCommand({
    ...input,
    sessionLabel,
    actorStaffId: actor.id,
    payloadHash: payloadHash(input),
    correctionRequestId: correction.id,
    decisionNote: parsed.data.decisionNote,
  });

  if (outcome.outcome !== "saved") {
    const reason = outcome.outcome === "refused" ? outcome.reason : outcome.outcome;
    throw new Error((attendanceRefusals[reason] ?? attendanceRefusals.failed).en);
  }

  revalidatePath("/teach/corrections");
  revalidatePath("/teach/attendance");
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
