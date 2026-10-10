"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import {
  admitStudent,
  countTcsIssued,
  editStudent,
  findNameMatches,
  searchFamilyCandidates,
  undoWithdraw,
  withdrawStudent,
  type AdmitInput,
  type EditPatch,
} from "@/modules/students-fees/vx/admissions";
import {
  enrolStudent,
  insertEnquiry,
  saveAdmissionDetail,
  setEnquiryStage,
  updateAdmissionDetail,
  type DocKey,
} from "@/vx/screens/admissions/data";
import { groupFamilies, isLikelySameChild, nextStage, parseDob, tcNumber, type FamilyCard, type Stage } from "@/vx/screens/admissions/logic";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Every write: `fees:manage` (admitting a child creates a fee record, which
 * the fee app keeps to the admin), then `assertNotPreviewing()`. The fee-side
 * functions check the fee app's own `students:write` again underneath.
 */

async function guard() {
  const staff = await assertPermission("fees:manage");
  await assertNotPreviewing();
  return staff;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export async function addEnquiryAction(input: { sessionLabel: string; childName: string; classLabel: string; parentName: string; phone: string }) {
  const staff = await guard();
  if (!input.childName.trim()) return { ok: false as const, message: "Write the child's name." };
  try {
    await insertEnquiry({ ...input, childName: input.childName.trim(), staffId: staff.id });
    revalidatePath("/admissions");
    return { ok: true as const, message: "Enquiry added." };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function moveEnquiryAction(id: string, from: Stage) {
  await guard();
  const to = nextStage(from);
  if (!to) return { ok: false as const, message: "This family is ready to admit." };
  try {
    await setEnquiryStage(id, to);
    revalidatePath("/admissions");
    return { ok: true as const, to };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function undoMoveEnquiryAction(id: string, back: Stage) {
  await guard();
  try {
    await setEnquiryStage(id, back);
    revalidatePath("/admissions");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function closeEnquiryAction(id: string) {
  await guard();
  try {
    await setEnquiryStage(id, "closed");
    revalidatePath("/admissions");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export type DuplicateHit = { id: string; fullName: string; fatherName: string | null; dateOfBirth: string | null; phone: string | null; admissionNo: string; classLabel: string; createdAt: string };

/** A read, but behind the same door: it names children and their parents. */
export async function checkDuplicateAction(input: { fullName: string; fatherName: string; dob: string; phone: string }): Promise<DuplicateHit[]> {
  await assertPermission("fees:manage");
  const dateOfBirth = parseDob(input.dob);
  const adding = { fullName: input.fullName, fatherName: input.fatherName, dateOfBirth, phone: input.phone };
  const matches = await findNameMatches(input.fullName);
  return matches
    .filter((m) => isLikelySameChild(adding, { fullName: m.fullName, fatherName: m.fatherName, dateOfBirth: m.dateOfBirth, phone: m.phone }))
    .map((m) => ({ id: m.id, fullName: m.fullName, fatherName: m.fatherName, dateOfBirth: m.dateOfBirth, phone: m.phone, admissionNo: m.admissionNo, classLabel: m.classLabel, createdAt: m.createdAt }));
}

export async function searchFamiliesAction(query: string): Promise<FamilyCard[]> {
  await assertPermission("fees:manage");
  const children = await searchFamilyCandidates(query);
  return groupFamilies(children).slice(0, 12);
}

export type AdmitRequest = Omit<AdmitInput, "dateOfBirth"> & {
  dob: string;
  nameHi: string;
  docs: Partial<Record<DocKey, boolean>>;
  enquiryId: string | null;
};

export async function admitAction(request: AdmitRequest) {
  const staff = await guard();
  const dateOfBirth = parseDob(request.dob);
  if (!dateOfBirth) return { ok: false as const, message: "Write the date like 21-08-2019.", fieldErrors: { dateOfBirth: "Write the date like 21-08-2019." } };
  try {
    const result = await admitStudent({ ...request, dateOfBirth });
    if (!result.ok) return { ok: false as const, message: result.message, fieldErrors: result.fieldErrors };
    // VPPS One's own records beside the fee row. A failure here does not undo
    // the admission — the child is on the roll — so it is reported, not thrown.
    let note: string | null = null;
    try {
      await saveAdmissionDetail({ studentId: result.studentId, sessionLabel: request.sessionLabel, nameHi: request.nameHi.trim() || null, docs: request.docs, enquiryId: request.enquiryId, staffId: staff.id });
      await enrolStudent({ studentId: result.studentId, classId: request.classId, sessionLabel: request.sessionLabel, userId: staff.userId });
      if (request.enquiryId) await setEnquiryStage(request.enquiryId, "admitted", result.studentId);
    } catch (error) {
      note = message(error);
    }
    revalidatePath("/admissions");
    return { ok: true as const, studentId: result.studentId, admissionNo: result.admissionNo, message: result.message, siblingMessage: result.siblingMessage, duesWarning: result.duesWarning, note };
  } catch (error) {
    return { ok: false as const, message: message(error), fieldErrors: {} as Record<string, string> };
  }
}

export async function editStudentAction(studentId: string, sessionLabel: string, patch: EditPatch & { dob?: string; nameHi?: string; docs?: Partial<Record<DocKey, boolean>> }) {
  await guard();
  const { dob, nameHi, docs, ...rest } = patch;
  const fee: EditPatch = { ...rest };
  if (dob !== undefined) {
    const iso = parseDob(dob);
    if (!iso) return { ok: false as const, message: "Write the date like 21-08-2019.", fieldErrors: { dateOfBirth: "Write the date like 21-08-2019." } };
    fee.dateOfBirth = iso;
  }
  try {
    if (Object.keys(fee).length > 0) {
      const saved = await editStudent(studentId, fee);
      if (!saved.ok) return { ok: false as const, message: saved.message, fieldErrors: saved.fieldErrors };
    }
    if (nameHi !== undefined || docs !== undefined) {
      await updateAdmissionDetail(studentId, sessionLabel, { nameHi: nameHi === undefined ? undefined : nameHi.trim() || null, docs });
    }
    revalidatePath(`/admissions/${studentId}`);
    return { ok: true as const, message: "Saved." };
  } catch (error) {
    return { ok: false as const, message: message(error), fieldErrors: {} as Record<string, string> };
  }
}

export async function withdrawAction(input: { studentId: string; sessionLabel: string; leftOn: string; reason: string }) {
  await guard();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.leftOn)) return { ok: false as const, message: "Pick the last day in school." };
  try {
    const tc = tcNumber(input.sessionLabel, (await countTcsIssued(input.sessionLabel)) + 1);
    const result = await withdrawStudent({ studentId: input.studentId, leftOn: input.leftOn, reason: input.reason, tcNumber: tc });
    revalidatePath(`/admissions/${input.studentId}`);
    revalidatePath("/admissions");
    return result.ok ? { ok: true as const, tcNumber: tc, message: result.message } : { ok: false as const, message: result.message };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function undoWithdrawAction(studentId: string) {
  await guard();
  try {
    const result = await undoWithdraw(studentId);
    revalidatePath(`/admissions/${studentId}`);
    return result;
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
