"use server";

import { createHash } from "node:crypto";
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
import { writeNoteSchema } from "@/modules/notes/domain/notes";
import {
  findAttendanceCommand,
  saveRegisterCommand,
  studentNames,
} from "@/modules/attendance/data/attendance-repo";
import { classScopeFor, heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import { deleteOwnNote, noteSessionLabel, writeNote } from "@/modules/notes/data/notes-repo";
import {
  assertClassVisible,
  assertSessionWritable,
  assertStudentVisible,
  passesFence,
} from "@/platform/auth/test-session-access";
import {
  idleTeachState,
  type TeachState,
} from "@/modules/attendance/domain/teach-state";
import { assertNotPreviewing } from "@/vx/view-as";

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
  // The class's own session (Phase 3 fence), not only the resolved one.
  if (!(await passesFence(() => assertClassVisible(actor, parsed.data.classId)))) {
    return { status: "refused", message: attendanceRefusals.not_permitted };
  }

  const held = await heldClassIds(actor.id, sessionLabel);
  const authority = registerAuthority({
    isOwner: held.includes(parsed.data.classId),
    hasMarkPermission: can(actor, "attendance:mark"),
    hasMarkOnBehalfPermission: can(actor, "attendance:mark_on_behalf"),
    hasCorrectPermission: can(actor, "attendance:correct"),
  });
  const allowed = parsed.data.kind === "save" ? authority.save : authority.correct;
  if (!allowed) return { status: "refused", message: authority.reason ?? attendanceRefusals.not_permitted };

  // No time limit and no approval: the class teacher corrects her own
  // register whenever she needs to, with a reason (D-248).

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

  // The record's own session (Phase 3 fence): a test account never writes a
  // note about a real child or class, nor real staff about a TEST one.
  const { studentId: noteStudentId, classId: noteClassId } = parsed.data;
  if (noteStudentId && !(await passesFence(() => assertStudentVisible(actor, noteStudentId)))) {
    return failure(m.notYourStudentTitle);
  }
  if (noteClassId && !(await passesFence(() => assertClassVisible(actor, noteClassId)))) {
    return failure(m.notYourClassTitle);
  }

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

  // The note's own session (Phase 3 fence) — a note written before an account
  // became a test account stays where it was written.
  const session = await noteSessionLabel(noteId);
  if (session && !(await passesFence(() => assertSessionWritable(actor, session)))) return;

  // Only your own, enforced in the query itself rather than checked first —
  // a tampered id cannot reach somebody else's note.
  await deleteOwnNote(noteId, actor.id);

  if (studentId) revalidatePath(`/teach/student/${studentId}`);
  if (classId) revalidatePath(`/teach/class/${classId}`);
}
