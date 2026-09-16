"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertPermission } from "@/platform/auth/current-staff";
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

function failure(
  fieldErrors: Record<string, string> = {},
  message: string | null = null,
  messageEn: string | null = null,
): AcademicsFormState {
  return { status: "error", fieldErrors, message, messageEn };
}

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !result[field]) result[field] = issue.message;
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
      code: `यह कोड ${clash.nameEn} के पास है · Already used by ${clash.nameEn}`,
    });
  }

  try {
    await createSubject(parsed.data, staff.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("subjects_code_unique_ci")) {
      return failure({ code: "यह कोड अभी-अभी ले लिया गया · That code was just taken" });
    }
    return failure({}, "विषय सहेजा नहीं जा सका।", `Could not save the subject: ${message}`);
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
  if (!id) return failure({}, "विषय नहीं मिला।", "That subject was not found.");

  const parsed = updateSubjectSchema.safeParse({
    nameHi: (formData.get("nameHi") ?? "").toString(),
    nameEn: (formData.get("nameEn") ?? "").toString(),
    sortOrder: (formData.get("sortOrder") ?? "0").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  try {
    await updateSubject(id, parsed.data);
  } catch (error) {
    return failure(
      {},
      "बदलाव सहेजे नहीं जा सके।",
      `Could not save: ${error instanceof Error ? error.message : String(error)}`,
    );
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
    return failure(
      {},
      "कोई सत्र नहीं मिला।",
      "No academic session was found in the fee app's classes.",
    );
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
      return failure({
        timetableLabel:
          "इस सत्र में यह नाम किसी और कक्षा का है · Another class already uses this label this session",
      });
    }
    return failure({}, "सहेजा नहीं जा सका।", `Could not save: ${message}`);
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
