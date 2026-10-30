"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { enrolMissingStudents, syncStudentEnrolments } from "@/modules/enrolments/data/enrolments-repo";
import { editStudent, type EditPatch } from "@/modules/students-fees/vx/admissions";
import { mergeFamily, splitFromFamily } from "@/modules/students-fees/vx/families";
import { approveSafeRows, checkImportRows, commitImport, uploadImport } from "@/modules/imports/vx/flow";
import { applyPromotion, buildPromotionList, loadPromotionBoard, promotionRunSessions, rollbackPromotion, setEntryTargets } from "@/modules/promotion/vx/promote";
import { logBulkChange, saveMark, skipQualityItem, unskipQualityItem } from "@/vx/screens/student-tools/data";
import { groupPlanWrites, planCounts, planPromotion, QUALITY_ISSUES, type PromoMark, type QualityIssue } from "@/vx/screens/student-tools/logic";
import { parseDob } from "@/vx/screens/admissions/logic";
import { assertNotPreviewing } from "@/vx/view-as";
import { assertFamilyVisible, assertSessionWritable, assertStudentsVisible, assertStudentVisible } from "@/platform/auth/test-session-access";

/*
 * Student tools writes. Every one: `fees:manage`, then
 * `assertNotPreviewing()`. The fee-side helpers check `students:write`
 * underneath, as the School Fees admin tools did.
 */

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function done() {
  revalidatePath("/student-tools");
}

/* --------------------------------------------------------------- promote */

export async function buildPromotionListAction(source: string, target: string) {
  const staff = await assertPermission("fees:manage");
  // Both years are written (the run, then the target's enrolments).
  await assertSessionWritable(staff, source);
  await assertSessionWritable(staff, target);
  await assertNotPreviewing();
  try {
    const runId = await buildPromotionList(source, target);
    done();
    return { ok: true as const, runId };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function markStudentAction(input: { runId: string; entryId: string; studentId: string; kind: PromoMark | null }) {
  const staff = await assertPermission("fees:manage");
  await assertStudentVisible(staff, input.studentId);
  await assertNotPreviewing();
  try {
    await saveMark({ ...input, staffId: staff.id });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

/** Save the class map and marks into the run, then apply it. */
export async function applyPromotionAction(input: { runId: string; classMap: Record<string, string>; marks: Record<string, PromoMark> }) {
  const staff = await assertPermission("fees:manage");
  await assertNotPreviewing();
  try {
    const board = await loadPromotionBoard(input.runId);
    if (!board.detail || board.detail.run.id !== input.runId) return { ok: false as const, message: "That promotion list was not found." };
    // The run's own years, whoever is asking (Phase 3 fence).
    await assertSessionWritable(staff, board.detail.run.sourceSessionLabel);
    await assertSessionWritable(staff, board.detail.run.targetSessionLabel);
    const entries = board.detail.entries.map((e) => ({ id: e.id, studentId: e.studentId, fromClassId: e.previousClassId, decision: e.decision, newClassId: e.newClassId }));
    const plan = planPromotion(entries, input.classMap, input.marks);
    const counts = planCounts(plan);
    if (counts.promote + counts.graduate === 0) return { ok: false as const, message: "Nobody is set to move up yet. Pick a class for each row." };
    const current = new Map(entries.map((e) => [e.id, { decision: e.decision, newClassId: e.newClassId }]));
    await setEntryTargets(input.runId, groupPlanWrites(plan, current));
    await applyPromotion(input.runId);
    // Promoted children onto their new class's register for the new session.
    await syncStudentEnrolments(entries.map((e) => e.studentId), staff.userId);
    await logBulkChange({
      kind: "promote",
      title: `Promoted ${counts.promote} students to ${board.targetSessionLabel}`,
      detail: { runId: input.runId, ...counts, source: board.sourceSessionLabel, target: board.targetSessionLabel },
      staffId: staff.id,
    });
    done();
    return { ok: true as const, counts };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function undoPromotionAction(runId: string) {
  const staff = await assertPermission("fees:manage");
  await assertNotPreviewing();
  try {
    // The run's own years (Phase 3 fence); no such run, nothing to undo.
    const years = await promotionRunSessions(runId);
    if (!years) return { ok: false as const, message: "That promotion list was not found." };
    await assertSessionWritable(staff, years.source);
    await assertSessionWritable(staff, years.target);
    await rollbackPromotion(runId);
    await logBulkChange({ kind: "promote_undo", title: "Promotion undone", detail: { runId }, staffId: staff.id });
    done();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

/* ---------------------------------------------------------------- import */

export async function uploadImportAction(formData: FormData) {
  await assertPermission("fees:manage");
  await assertSessionWritable(null, String(formData.get("sessionLabel") ?? ""), { orActive: true });
  await assertNotPreviewing();
  const file = formData.get("file");
  const session = formData.get("sessionLabel");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, message: "Choose a CSV or Excel file first." };
  try {
    const result = await uploadImport(file, typeof session === "string" && session.trim() ? session.trim() : null);
    done();
    return { ok: true as const, batchId: result.batchId, autoValidated: result.autoValidated };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function checkImportAction(batchId: string, mapping: Record<string, string>, headers: string[]) {
  await assertPermission("fees:manage");
  await assertNotPreviewing();
  try {
    const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    const res = await checkImportRows(batchId, clean, headers);
    done();
    return res.ok ? { ok: true as const } : { ok: false as const, message: res.errors.join(" ") };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function approveSafeRowsAction(batchId: string) {
  await assertPermission("fees:manage");
  await assertNotPreviewing();
  try {
    await approveSafeRows(batchId);
    done();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function commitImportAction(batchId: string, filename: string) {
  const staff = await assertPermission("fees:manage");
  await assertNotPreviewing();
  try {
    const result = await commitImport(batchId);
    if (result.importedCount > 0) {
      const sessionLabel = await resolveSessionLabel();
      if (sessionLabel) await enrolMissingStudents(sessionLabel, staff.userId);
    }
    if (result.importedCount > 0 && result.remainingCount === 0) {
      await logBulkChange({ kind: "import", title: `Imported ${result.importedCount} students from ${filename}`, detail: { batchId, ...result }, staffId: staff.id });
    }
    done();
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

/* --------------------------------------------------------------- quality */

const ISSUE_FIELD: Partial<Record<QualityIssue, keyof EditPatch>> = {
  father_phone: "fatherPhone",
  dob: "dateOfBirth",
  age: "dateOfBirth",
  mother_name: "motherName",
  address: "address",
};

export async function fixQualityAction(input: { studentId: string; issue: QualityIssue; value: string }) {
  const staff = await assertPermission("fees:manage");
  await assertStudentVisible(staff, input.studentId);
  await assertNotPreviewing();
  const field = ISSUE_FIELD[input.issue];
  if (!field) return { ok: false as const, message: "This one is fixed from the student's record." };
  let value = input.value.trim();
  if (!value) return { ok: false as const, message: "Write the correct value first." };
  if (field === "dateOfBirth") {
    const iso = parseDob(value);
    if (!iso) return { ok: false as const, message: "Write the date like 21-08-2019." };
    value = iso;
  }
  if (field === "fatherPhone") {
    value = value.replace(/\D/g, "").slice(-10);
    if (value.length !== 10) return { ok: false as const, message: "A mobile number has 10 digits." };
  }
  try {
    const res = await editStudent(input.studentId, { [field]: value });
    if (!res.ok) return { ok: false as const, message: Object.values(res.fieldErrors)[0] ?? res.message };
    await logBulkChange({ kind: "quality", title: `Fixed ${input.issue.replace("_", " ")}`, detail: { studentId: input.studentId, issue: input.issue }, staffId: staff.id });
    done();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function skipQualityAction(input: { studentId: string; issue: QualityIssue; days: number }) {
  const staff = await assertPermission("fees:manage");
  await assertStudentVisible(staff, input.studentId);
  await assertNotPreviewing();
  if (!QUALITY_ISSUES.includes(input.issue)) return { ok: false as const, message: "Unknown item." };
  const until = new Date(Date.now() + Math.min(365, Math.max(1, input.days)) * 86_400_000).toISOString().slice(0, 10);
  try {
    await skipQualityItem({ studentId: input.studentId, issue: input.issue, until, staffId: staff.id });
    done();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function unskipQualityAction(input: { studentId: string; issue: QualityIssue }) {
  const staff = await assertPermission("fees:manage");
  await assertStudentVisible(staff, input.studentId);
  await assertNotPreviewing();
  try {
    await unskipQualityItem(input.studentId, input.issue);
    done();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

/* -------------------------------------------------------------- families */

export async function mergeFamilyAction(input: { studentIds: string[]; sessionLabel: string; father: string }) {
  const staff = await assertPermission("fees:manage");
  await assertSessionWritable(staff, input.sessionLabel);
  // The label is the caller's; each child's own session is the fence.
  await assertStudentsVisible(staff, input.studentIds);
  await assertNotPreviewing();
  try {
    const res = await mergeFamily(input.studentIds, input.sessionLabel);
    if (!res.ok) return { ok: false as const, message: res.message };
    await logBulkChange({ kind: "merge", title: `Linked ${input.studentIds.length} children as one family (${input.father})`, detail: { studentIds: input.studentIds, familyGroupId: res.familyGroupId }, staffId: staff.id });
    done();
    return { ok: true as const, message: res.message };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function splitFamilyAction(input: { studentId: string; familyGroupId: string; sessionLabel: string; name: string }) {
  const staff = await assertPermission("fees:manage");
  await assertSessionWritable(staff, input.sessionLabel);
  await assertStudentVisible(staff, input.studentId);
  await assertFamilyVisible(staff, input.familyGroupId);
  await assertNotPreviewing();
  try {
    const res = await splitFromFamily(input.studentId, input.familyGroupId, input.sessionLabel);
    if (!res.ok) return { ok: false as const, message: res.message };
    await logBulkChange({ kind: "split", title: `Took ${input.name} out of a family`, detail: { studentId: input.studentId, familyGroupId: input.familyGroupId }, staffId: staff.id });
    done();
    return { ok: true as const, message: res.message };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}
