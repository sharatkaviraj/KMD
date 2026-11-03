import { z } from "zod";

import { m } from "@/messages";
import {
  encodeMessage,
  t,
  type Language,
  type Localized,
} from "@/platform/i18n/language";

import { staffRoles, type StaffRole } from "@/platform/auth/permissions";

/**
 * Staff validation and normalisation. Pure — no database import, no framework
 * import — so every rule below is testable without a request or a row.
 *
 * The rules live here rather than in the form because the form is not the only
 * way in: the seed script writes profiles, and Phase 2's timetable import will
 * want to create a missing teacher from a short name it found in a cell.
 */

/**
 * `short_name` is the timetable's join key and immutable once written, so its
 * shape is the one rule worth being strict about. Uppercase A–Z and digits,
 * 2–8 characters.
 *
 * Uppercased on the way in rather than rejected: a teacher typing "rks" means
 * RKS, and the unique index is case-insensitive anyway, so accepting the
 * lowercase form and storing it folded is one fewer error message for the same
 * guarantee.
 */
export const SHORT_NAME_PATTERN = /^[A-Z0-9]{2,8}$/;

export function normalizeShortName(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Phone numbers as the school actually types them: with spaces, with dashes,
 * with +91, with a leading 0. Stored as the ten digits, because that is what
 * matches a parent record and what AiSensy wants in Phase 5.
 *
 * Returns null for anything that is not an Indian mobile number rather than
 * guessing — a wrong number that looks right is worse than a blank.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // 9876543210, 09876543210, 919876543210, +919876543210
  const ten = digits.length > 10 ? digits.slice(-10) : digits;

  if (ten.length !== 10) return null;
  // Indian mobile numbers start 6–9. A landline or a typo fails here.
  if (!/^[6-9]/.test(ten)) return null;

  return ten;
}

const optionalPhone = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .refine(
    (value) => value === null || normalizePhone(value) !== null,
    {
      message: encodeMessage(
        t(
          "दस अंकों का मोबाइल नंबर डालें",
          "Enter a 10-digit mobile number",
        ),
      ),
    },
  )
  .transform((value) => (value === null ? null : normalizePhone(value)));

const displayName = z
  .string()
  .trim()
  .min(2, {
    message: encodeMessage(
      t("नाम कम से कम दो अक्षर का हो", "Name needs at least two characters"),
    ),
  })
  .max(80, {
    message: encodeMessage(t("नाम बहुत लंबा है", "Name is too long")),
  });

const shortName = z
  .string()
  .trim()
  .transform(normalizeShortName)
  .refine((value) => SHORT_NAME_PATTERN.test(value), {
    message: encodeMessage(
      t(
        "2–8 अक्षर या अंक, केवल अंग्रेज़ी बड़े अक्षर",
        "2–8 letters or digits, A–Z and 0–9 only",
      ),
    ),
  });

const role = z.enum(staffRoles);

const preferredLanguage = z.enum(["hi", "en", "both"]);

/** Creating a profile. `short_name` is settable exactly once — here. */
export const createStaffSchema = z.object({
  displayName,
  shortName,
  role,
  phone: optionalPhone,
  whatsappPhone: optionalPhone,
  isTeaching: z.boolean(),
  preferredLanguage,
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/**
 * Editing a profile. `shortName` is deliberately absent: the database trigger
 * refuses to change it, and a field the form cannot submit is a clearer
 * promise than one that submits and is rejected.
 */
export const updateStaffSchema = z.object({
  displayName,
  /** Applied only when an administrator changes it — see `authorityChangeIn`. */
  role,
  phone: optionalPhone,
  whatsappPhone: optionalPhone,
  isTeaching: z.boolean(),
  preferredLanguage,
});

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

/** A checkbox that is absent from FormData means false, not undefined. */
export function checkboxValue(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true";
}

export type StaffProfile = {
  id: string;
  userId: string | null;
  displayName: string;
  shortName: string;
  role: StaffRole;
  phone: string | null;
  whatsappPhone: string | null;
  isTeaching: boolean;
  isActive: boolean;
  /** Which language this person reads the app in (D-35). */
  language: Language;
  createdAt: string;
};

/**
 * The order a staff list reads best in: teaching staff first, then by name.
 *
 * Inactive profiles sink to the bottom whatever else is true — they are kept
 * because the timetable still references them, not because anybody is looking
 * for them.
 */
export function compareStaff(a: StaffProfile, b: StaffProfile): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  if (a.isTeaching !== b.isTeaching) return a.isTeaching ? -1 : 1;
  return a.displayName.localeCompare(b.displayName, "en");
}

/**
 * Free-text search over a staff list.
 *
 * Matches the display name, the short name and the phone digits, because those
 * are the three things somebody knows when they are looking: who it is, what
 * the timetable calls them, or the number they are about to ring.
 */
export function matchesStaffSearch(staff: StaffProfile, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const digits = needle.replace(/\D/g, "");

  return (
    staff.displayName.toLowerCase().includes(needle) ||
    staff.shortName.toLowerCase().includes(needle) ||
    (digits.length >= 3 &&
      ((staff.phone ?? "").includes(digits) ||
        (staff.whatsappPhone ?? "").includes(digits)))
  );
}

/* ------------------------------------------------------- who may change what */

/**
 * The roles somebody without the administrator's role may give a new profile.
 *
 * The office keeps staff records — names, numbers, who teaches — and that is
 * worth keeping (PLAN §3). What it stops being able to do is decide who holds
 * power: a profile created as an accountant or a coordinator becomes one the
 * day a login is linked to it, and before P1 the office could also promote an
 * existing linked colleague to administrator, or switch an administrator off
 * (D-205). A teacher or a view-only profile grants nothing a teacher cannot
 * already see.
 */
export const NON_ADMIN_ASSIGNABLE_ROLES: readonly StaffRole[] = ["teacher", "view_only"];

/** The roles this actor may put on a profile they are creating. */
export function rolesAssignableBy(actorRole: StaffRole): readonly StaffRole[] {
  return actorRole === "admin" ? staffRoles : NON_ADMIN_ASSIGNABLE_ROLES;
}

/** Whether this actor may change role or activation at all. Only an admin. */
export function mayChangeAuthority(actorRole: StaffRole): boolean {
  return actorRole === "admin";
}

/** Why `change_staff_authority` said no. The database's own words. */
export type AuthorityRefusal = "not_admin" | "not_found" | "self" | "last_admin" | "test_account";

export const authorityRefusalMessages: Record<AuthorityRefusal, Localized> = {
  not_admin: t(
    "भूमिका या पहुँच केवल प्रशासक बदल सकते हैं।",
    "Only an administrator can change a role or switch access on or off.",
  ),
  not_found: t("यह प्रोफ़ाइल नहीं मिली।", "That profile was not found."),
  self: t(
    "आप अपनी ही भूमिका या पहुँच नहीं बदल सकते।",
    "You cannot change your own role or access. Ask another administrator.",
  ),
  last_admin: t(
    "स्कूल में कम से कम एक सक्रिय प्रशासक रहना ज़रूरी है।",
    "The school must keep at least one active administrator.",
  ),
  // Phase 3 (D-340): a test account manages only test accounts.
  test_account: t(
    "टेस्ट खाता केवल टेस्ट खातों को बदल सकता है।",
    "A test account can change only test accounts.",
  ),
};

/**
 * Whether an edit changes authority, which is admin-only, or only the record.
 *
 * Pure so the action and its test agree: the action calls this, then sends the
 * record half through `updateStaff` and the authority half through the
 * database command.
 */
export function authorityChangeIn(
  target: Pick<StaffProfile, "role" | "isActive">,
  next: { role?: StaffRole; isActive?: boolean },
): { role: StaffRole; isActive: boolean } | null {
  const role = next.role ?? target.role;
  const isActive = next.isActive ?? target.isActive;
  return role === target.role && isActive === target.isActive ? null : { role, isActive };
}

/**
 * Whether deactivating this profile is safe to offer.
 *
 * A staff member cannot deactivate themselves: they would lose the app on the
 * next navigation, and if they were the only admin nobody could undo it.
 */
export function canDeactivate(
  target: Pick<StaffProfile, "id" | "isActive">,
  actorStaffId: string,
): { allowed: boolean; reason?: Localized } {
  if (!target.isActive) {
    return { allowed: false, reason: m.alreadyInactive };
  }

  if (target.id === actorStaffId) {
    return { allowed: false, reason: m.cannotDeactivateSelf };
  }

  return { allowed: true };
}
