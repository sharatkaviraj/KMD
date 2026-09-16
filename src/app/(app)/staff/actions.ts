"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertPermission } from "@/platform/auth/current-staff";
import {
  canDeactivate,
  checkboxValue,
  createStaffSchema,
  normalizeShortName,
  updateStaffSchema,
} from "@/modules/staff/domain/staff";
import {
  createStaff,
  findByShortName,
  getStaffById,
  setStaffActive,
  updateStaff,
} from "@/modules/staff/data/staff-repo";

export type StaffFormState = {
  status: "idle" | "error";
  /** Field name -> message. Rendered next to the input that is wrong. */
  fieldErrors: Record<string, string>;
  /** Hindi. For a failure that is not about one field. */
  message: string | null;
  messageEn: string | null;
};

function failure(
  fieldErrors: Record<string, string> = {},
  message: string | null = null,
  messageEn: string | null = null,
): StaffFormState {
  return { status: "error", fieldErrors, message, messageEn };
}

/** Zod's issues, flattened onto the field names the form uses. */
function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !result[field]) {
      result[field] = issue.message;
    }
  }
  return result;
}

function readForm(formData: FormData) {
  return {
    displayName: (formData.get("displayName") ?? "").toString(),
    role: (formData.get("role") ?? "").toString(),
    phone: (formData.get("phone") ?? "").toString(),
    whatsappPhone: (formData.get("whatsappPhone") ?? "").toString(),
    isTeaching: checkboxValue(formData.get("isTeaching")),
    preferredLanguage: (formData.get("preferredLanguage") ?? "hi").toString(),
  };
}

export async function createStaffAction(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const staff = await assertPermission("staff:manage");

  const parsed = createStaffSchema.safeParse({
    ...readForm(formData),
    shortName: (formData.get("shortName") ?? "").toString(),
  });

  if (!parsed.success) {
    return failure(fieldErrorsFrom(parsed.error));
  }

  // Checked before the insert so the message lands on the field rather than
  // arriving as a unique-constraint violation nobody can read. The index is
  // still the thing that guarantees it — this is only for the wording.
  const clash = await findByShortName(parsed.data.shortName);
  if (clash) {
    return failure({
      shortName: `यह नाम ${clash.displayName} के पास है · Already used by ${clash.displayName}`,
    });
  }

  try {
    await createStaff(parsed.data, staff.userId);
  } catch (error) {
    // The race the check above cannot close: two admins submitting the same
    // short name at once. The index catches it; this translates it.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("staff_profiles_short_name_unique_ci")) {
      return failure({
        shortName: "यह संक्षिप्त नाम अभी-अभी ले लिया गया · That short name was just taken",
      });
    }
    return failure(
      {},
      "प्रोफ़ाइल सहेजी नहीं जा सकी।",
      `Could not save the profile: ${message}`,
    );
  }

  revalidatePath("/staff");
  redirect("/staff");
}

export async function updateStaffAction(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const actor = await assertPermission("staff:manage");
  const id = (formData.get("id") ?? "").toString();

  if (!id) {
    return failure({}, "प्रोफ़ाइल नहीं मिली।", "That profile was not found.");
  }

  const parsed = updateStaffSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return failure(fieldErrorsFrom(parsed.error));
  }

  const target = await getStaffById(id);
  if (!target) {
    return failure({}, "प्रोफ़ाइल नहीं मिली।", "That profile was not found.");
  }

  // Changing your own role is how an admin accidentally locks the school out
  // of its own master data — there may be only one of them.
  if (target.id === actor.id && parsed.data.role !== actor.role) {
    return failure(
      { role: "अपनी भूमिका आप नहीं बदल सकते · You cannot change your own role" },
    );
  }

  // Submitting a short name at all means the form was tampered with: the field
  // is rendered read-only and is not in the update schema. Refuse rather than
  // silently ignore, so the caller learns the rule.
  const submittedShortName = formData.get("shortName");
  if (
    submittedShortName &&
    normalizeShortName(submittedShortName.toString()) !== target.shortName
  ) {
    return failure({
      shortName:
        "संक्षिप्त नाम बदला नहीं जा सकता · The short name cannot be changed",
    });
  }

  try {
    await updateStaff(id, parsed.data);
  } catch (error) {
    return failure(
      {},
      "बदलाव सहेजे नहीं जा सके।",
      `Could not save the changes: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
  redirect(`/staff/${id}`);
}

export async function setStaffActiveAction(formData: FormData) {
  const actor = await assertPermission("staff:manage");
  const id = (formData.get("id") ?? "").toString();
  const nextActive = formData.get("isActive") === "true";

  const target = await getStaffById(id);
  if (!target) {
    throw new Error("That profile was not found.");
  }

  // The same rule the button's disabled state uses, checked again here —
  // a disabled button is a hint, not a guard.
  if (!nextActive) {
    const verdict = canDeactivate(target, actor.id);
    if (!verdict.allowed) {
      throw new Error(verdict.reasonEn ?? "Cannot deactivate this profile.");
    }
  }

  await setStaffActive(id, nextActive);

  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
}
