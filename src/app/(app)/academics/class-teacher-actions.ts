"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertPermission } from "@/platform/auth/current-staff";
import { decodeMessage, t, type Localized } from "@/platform/i18n/language";
import {
  assignClassTeacherSchema,
  validateAssignment,
} from "@/modules/academics/domain/class-teachers";
import {
  calendarDaySchema,
  rangeIsTooLong,
  MAX_RANGE_DAYS,
} from "@/modules/academics/domain/calendar";
import {
  assignClassTeacher,
  deleteCalendarDay,
  endClassTeacherTerm,
  getCurrentClassTeacher,
  upsertCalendarDays,
} from "@/modules/academics/data/class-teachers-repo";
import { getStaffById } from "@/modules/staff/data/staff-repo";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import {
  idleAcademicsState,
  type AcademicsFormState,
} from "@/modules/academics/domain/form-state";
import { assertSessionWritable } from "@/platform/auth/test-session-access";

function failure(
  fieldErrors: Record<string, Localized> = {},
  message: Localized | null = null,
): AcademicsFormState {
  return { status: "error", fieldErrors, message };
}

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

export async function assignClassTeacherAction(
  _previous: AcademicsFormState,
  formData: FormData,
): Promise<AcademicsFormState> {
  const actor = await assertPermission("academics:manage");
  if (formData.get("sessionLabel")) await assertSessionWritable(actor, formData.get("sessionLabel")?.toString());

  const sessionLabel = await resolveSessionLabel(
    formData.get("sessionLabel")?.toString(),
  );
  if (!sessionLabel) return failure({}, m.noSessionFound);

  const parsed = assignClassTeacherSchema.safeParse({
    classId: (formData.get("classId") ?? "").toString(),
    staffProfileId: (formData.get("staffProfileId") ?? "").toString(),
    role: (formData.get("role") ?? "class_teacher").toString(),
    effectiveFrom: (formData.get("effectiveFrom") ?? "").toString(),
    replacedReason: (formData.get("replacedReason") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  const [current, staff] = await Promise.all([
    getCurrentClassTeacher(parsed.data.classId, sessionLabel, parsed.data.role),
    getStaffById(parsed.data.staffProfileId),
  ]);

  // The same rules the screen used to grey out the option, checked again:
  // a disabled option is a hint, not a guard.
  const verdict = validateAssignment(parsed.data, current, staff);
  if (!verdict.allowed) {
    return failure({ staffProfileId: verdict.reason! });
  }

  try {
    await assignClassTeacher(parsed.data, sessionLabel, actor.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Two admins assigning the same class at once: the partial unique index
    // allows exactly one open row, and the loser lands here.
    if (message.includes("class_teachers_one_current_per_class")) {
      return failure({
        staffProfileId: t(
          "यह कक्षा अभी-अभी किसी और को दी गई। पेज ताज़ा करें।",
          "This class was just given to somebody else. Reload the page.",
        ),
      });
    }
    return failure({}, m.notSaved);
  }

  revalidatePath("/academics/class-teachers");
  return { ...idleAcademicsState, status: "saved" };
}

export async function endClassTeacherTermAction(formData: FormData) {
  await assertPermission("academics:manage");

  const id = (formData.get("id") ?? "").toString();
  const lastDay = (formData.get("lastDay") ?? "").toString();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return;

  await endClassTeacherTerm(
    id,
    lastDay,
    (formData.get("reason") ?? "").toString().trim() || null,
  );
  revalidatePath("/academics/class-teachers");
}

/* ------------------------------------------------------------- calendar */

export async function saveCalendarDayAction(
  _previous: AcademicsFormState,
  formData: FormData,
): Promise<AcademicsFormState> {
  const actor = await assertPermission("academics:manage");
  if (formData.get("sessionLabel")) await assertSessionWritable(actor, formData.get("sessionLabel")?.toString());

  const sessionLabel = await resolveSessionLabel(
    formData.get("sessionLabel")?.toString(),
  );
  if (!sessionLabel) return failure({}, m.noSessionFound);

  const parsed = calendarDaySchema.safeParse({
    day: (formData.get("day") ?? "").toString(),
    until: (formData.get("until") ?? "").toString(),
    kind: (formData.get("kind") ?? "holiday").toString(),
    labelHi: (formData.get("labelHi") ?? "").toString(),
    labelEn: (formData.get("labelEn") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  // A mistyped year turns "mark a week" into four thousand rows.
  if (rangeIsTooLong(parsed.data.day, parsed.data.until)) {
    return failure({
      until: t(
        `एक बार में ${MAX_RANGE_DAYS} दिन तक`,
        `At most ${MAX_RANGE_DAYS} days at a time`,
      ),
    });
  }

  try {
    await upsertCalendarDays(parsed.data, sessionLabel, actor.userId);
  } catch {
    return failure({}, m.notSaved);
  }

  revalidatePath("/calendar", "layout");
  return { ...idleAcademicsState, status: "saved" };
}

export async function deleteCalendarDayAction(formData: FormData) {
  await assertPermission("academics:manage");
  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await deleteCalendarDay(id);
  revalidatePath("/calendar", "layout");
}
