"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { m } from "@/messages";
import { assertPermission } from "@/platform/auth/current-staff";
import { decodeMessage, t, type Localized } from "@/platform/i18n/language";
import {
  classAliasSchema,
  createSubjectSchema,
  updateSubjectSchema,
} from "@/modules/academics/domain/subjects";
import {
  createSubject,
  deleteClassAlias,
  findSubjectByCode,
  resolveSessionLabel,
  setSubjectActive,
  updateSubject,
  upsertClassAlias,
} from "@/modules/academics/data/academics-repo";

import {
  idleAcademicsState,
  type AcademicsFormState,
} from "@/modules/academics/domain/form-state";
import { saveAttendanceRules } from "@/modules/attendance/data/attendance-repo";

function failure(
  fieldErrors: Record<string, Localized> = {},
  message: Localized | null = null,
): AcademicsFormState {
  return { status: "error", fieldErrors, message };
}

/**
 * Zod carries a `string`, so the domain encodes each pair as JSON and this is
 * where it is unpacked.
 */
function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, Localized> {
  const result: Record<string, Localized> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !result[field]) result[field] = decodeMessage(issue.message);
  }
  return result;
}

/* --------------------------------------------------------------- subjects */

export async function createSubjectAction(
  _previous: AcademicsFormState,
  formData: FormData,
): Promise<AcademicsFormState> {
  const staff = await assertPermission("academics:manage");

  const parsed = createSubjectSchema.safeParse({
    code: (formData.get("code") ?? "").toString(),
    nameHi: (formData.get("nameHi") ?? "").toString(),
    nameEn: (formData.get("nameEn") ?? "").toString(),
    sortOrder: (formData.get("sortOrder") ?? "0").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  const clash = await findSubjectByCode(parsed.data.code);
  if (clash) {
    return failure({
      code: t(
        `यह कोड ${clash.nameEn} के पास है`,
        `Already used by ${clash.nameEn}`,
      ),
    });
  }

  try {
    await createSubject(parsed.data, staff.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("subjects_code_unique_ci")) {
      return failure({
        code: t("यह कोड अभी-अभी ले लिया गया", "That code was just taken"),
      });
    }
    return failure({}, m.subjectNotSaved);
  }

  revalidatePath("/academics/subjects");
  redirect("/academics/subjects");
}

export async function updateSubjectAction(
  _previous: AcademicsFormState,
  formData: FormData,
): Promise<AcademicsFormState> {
  await assertPermission("academics:manage");
  const id = (formData.get("id") ?? "").toString();
  if (!id) return failure({}, m.subjectNotFound);

  const parsed = updateSubjectSchema.safeParse({
    nameHi: (formData.get("nameHi") ?? "").toString(),
    nameEn: (formData.get("nameEn") ?? "").toString(),
    sortOrder: (formData.get("sortOrder") ?? "0").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  try {
    await updateSubject(id, parsed.data);
  } catch {
    return failure({}, m.changesNotSaved);
  }

  revalidatePath("/academics/subjects");
  redirect("/academics/subjects");
}

export async function setSubjectActiveAction(formData: FormData) {
  await assertPermission("academics:manage");
  const id = (formData.get("id") ?? "").toString();
  const nextActive = formData.get("isActive") === "true";

  await setSubjectActive(id, nextActive);
  revalidatePath("/academics/subjects");
}

/* ---------------------------------------------------------- class aliases */

export async function saveClassAliasAction(
  _previous: AcademicsFormState,
  formData: FormData,
): Promise<AcademicsFormState> {
  const staff = await assertPermission("academics:manage");

  const sessionLabel = await resolveSessionLabel(
    formData.get("sessionLabel")?.toString(),
  );

  if (!sessionLabel) {
    return failure({}, m.noSessionFound);
  }

  const parsed = classAliasSchema.safeParse({
    classId: (formData.get("classId") ?? "").toString(),
    timetableLabel: (formData.get("timetableLabel") ?? "").toString(),
    displayName: (formData.get("displayName") ?? "").toString(),
    sortOrder: (formData.get("sortOrder") ?? "0").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  try {
    await upsertClassAlias(parsed.data, sessionLabel, staff.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Two classes cannot share one timetable label in a session: the import
    // would have no way to tell which class a cell meant.
    if (message.includes("class_aliases_label_per_session_unique_ci")) {
      return failure({ timetableLabel: m.labelTakenByAnotherClass });
    }
    return failure({}, m.notSaved);
  }

  revalidatePath("/academics/classes");
  return { ...idleAcademicsState, status: "saved" };
}

export async function deleteClassAliasAction(formData: FormData) {
  await assertPermission("academics:manage");
  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await deleteClassAlias(id);
  revalidatePath("/academics/classes");
}

/* ------------------------------------------------------ attendance rules */

/**
 * How much a half day counts, for the current session (P6). Every percentage
 * reads it, so it is the academic coordinator's or an administrator's to set,
 * not a teacher's.
 */
export async function saveAttendanceRulesAction(
  _previous: AcademicsFormState,
  formData: FormData,
): Promise<AcademicsFormState> {
  const actor = await assertPermission("academics:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure({}, m.noSessionFound);

  const raw = (formData.get("halfDayCredit") ?? "").toString().trim();
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value) || value < 0 || value > 1) {
    return failure({ halfDayCredit: m.attendanceRulesRange });
  }

  try {
    await saveAttendanceRules({
      sessionLabel,
      halfDayCredit: Math.round(value * 100) / 100,
      actorStaffId: actor.id,
    });
  } catch {
    return failure({}, m.notSaved);
  }

  revalidatePath("/academics");
  return { ...idleAcademicsState, status: "saved" };
}
