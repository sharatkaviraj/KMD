"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { m } from "@/messages";
import { assertPermission } from "@/platform/auth/current-staff";
import { decodeMessage, t, type Localized } from "@/platform/i18n/language";
import {
  authorityChangeIn,
  authorityRefusalMessages,
  canDeactivate,
  checkboxValue,
  createStaffSchema,
  mayChangeAuthority,
  normalizeShortName,
  rolesAssignableBy,
  updateStaffSchema,
} from "@/modules/staff/domain/staff";
import {
  changeStaffAuthority,
  createStaff,
  findByShortName,
  getStaffById,
  updateStaff,
} from "@/modules/staff/data/staff-repo";

export type StaffFormState = {
  status: "idle" | "error";
  /** Field name -> message pair. The form renders the reader's half. */
  fieldErrors: Record<string, Localized>;
  /** For a failure that is not about one field. */
  message: Localized | null;
};

function failure(
  fieldErrors: Record<string, Localized> = {},
  message: Localized | null = null,
): StaffFormState {
  return { status: "error", fieldErrors, message };
}

/**
 * Zod's issues, flattened onto the field names the form uses.
 *
 * Zod carries a `string`, so the domain encodes each pair as JSON and this is
 * where it is unpacked. A message from somewhere else — one of Zod's own
 * built-ins — decodes to itself in both halves rather than vanishing.
 */
function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, Localized> {
  const result: Record<string, Localized> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !result[field]) {
      result[field] = decodeMessage(issue.message);
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

  // A new profile's role is who that person becomes the day a login is linked
  // to it, so the office may create teachers and viewers and nothing that
  // holds power (D-205). Checked here; the form only offers what passes.
  if (!rolesAssignableBy(staff.role).includes(parsed.data.role)) {
    return failure({ role: authorityRefusalMessages.not_admin });
  }

  // Checked before the insert so the message lands on the field rather than
  // arriving as a unique-constraint violation nobody can read. The index is
  // still the thing that guarantees it — this is only for the wording.
  const clash = await findByShortName(parsed.data.shortName);
  if (clash) {
    return failure({
      shortName: t(
        `यह नाम ${clash.displayName} के पास है`,
        `Already used by ${clash.displayName}`,
      ),
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
        shortName: t(
          "यह संक्षिप्त नाम अभी-अभी ले लिया गया",
          "That short name was just taken",
        ),
      });
    }
    return failure({}, m.profileNotSaved);
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
    return failure({}, m.profileNotFound);
  }

  const parsed = updateStaffSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return failure(fieldErrorsFrom(parsed.error));
  }

  const target = await getStaffById(id);
  if (!target) {
    return failure({}, m.profileNotFound);
  }

  // Changing your own role is how an admin accidentally locks the school out
  // of its own master data — there may be only one of them.
  if (target.id === actor.id && parsed.data.role !== actor.role) {
    return failure({ role: m.cannotChangeOwnRole });
  }

  // The record and the authority are two different edits (D-205). Anybody with
  // `staff:manage` may correct a name or a number; only an administrator may
  // change what this person is allowed to do.
  const authority = authorityChangeIn(target, { role: parsed.data.role });
  if (authority && !mayChangeAuthority(actor.role)) {
    return failure({ role: authorityRefusalMessages.not_admin });
  }

  // Submitting a short name at all means the form was tampered with: the field
  // is rendered read-only and is not in the update schema. Refuse rather than
  // silently ignore, so the caller learns the rule.
  const submittedShortName = formData.get("shortName");
  if (
    submittedShortName &&
    normalizeShortName(submittedShortName.toString()) !== target.shortName
  ) {
    return failure({ shortName: m.shortNameImmutable });
  }

  try {
    await updateStaff(id, parsed.data);
  } catch {
    return failure({}, m.changesNotSaved);
  }

  if (authority) {
    const result = await changeStaffAuthority({
      actorStaffId: actor.id,
      targetStaffId: id,
      role: authority.role,
      isActive: authority.isActive,
    }).catch(() => null);

    if (!result) return failure({}, m.changesNotSaved);
    if (!result.ok) return failure({ role: authorityRefusalMessages[result.reason] });
  }

  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
  redirect(`/staff/${id}`);
}

/**
 * Switch somebody's access on or off. Administrators only (D-205).
 *
 * A plain form action rather than a stateful one, so a refusal throws into the
 * page's error boundary; the button is not rendered for anybody who would be
 * refused, so reaching the throw means the form was replayed or tampered with.
 */
export async function setStaffActiveAction(formData: FormData) {
  const actor = await assertPermission("staff:manage");
  if (!mayChangeAuthority(actor.role)) {
    throw new Error(authorityRefusalMessages.not_admin.en);
  }

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
      throw new Error(verdict.reason?.en ?? "Cannot deactivate this profile.");
    }
  }

  const result = await changeStaffAuthority({
    actorStaffId: actor.id,
    targetStaffId: id,
    role: target.role,
    isActive: nextActive,
  });
  if (!result.ok) {
    throw new Error(authorityRefusalMessages[result.reason].en);
  }

  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
}
