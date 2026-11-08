"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { viewingTestSession } from "@/platform/auth/staff-scope";
import { isStaffRole } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import {
  actorMayManage,
  changeStaffAuthority,
  createStaff,
  findByShortName,
  getStaffById,
} from "@/modules/staff/data/staff-repo";
import {
  authorityRefusalMessages,
  canDeactivate,
  createStaffSchema,
  mayChangeAuthority,
  rolesAssignableBy,
} from "@/modules/staff/domain/staff";
import { assertNotPreviewing } from "@/vx/view-as";
import { p, type Pair } from "@/vx/text";
import { cleanChanges, MATRIX_REFUSALS } from "@/vx/screens/staff/domain/matrix";
import { DISABLE_REASONS, tempPasswordFrom } from "@/vx/screens/staff/domain/people";

/*
 * Staff & roles (design `Staff`). Every write: permission first, then
 * assertNotPreviewing(), then the existing database command where there is
 * one (`change_staff_authority`, `set_role_permissions`).
 */

export type StaffActionResult =
  | { ok: true; message: Pair; password?: string; username?: string; staffId?: string }
  | { ok: false; message: Pair };

const fail = (message: Pair): StaffActionResult => ({ ok: false, message });
const fromLocalized = (l: { hi: string; en: string }): Pair => ({ en: l.en, hi: l.hi });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Save the edited role matrix: admin only, Admin locked, every change logged. */
export async function saveMatrixAction(changes: unknown, reason?: string): Promise<StaffActionResult> {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  if (actor.role !== "admin") return fail(MATRIX_REFUSALS.not_admin);
  // The permission matrix is the whole school's: never a test account's (Phase 3).
  if (actor.isTestAccount === true) return fail(fromLocalized(authorityRefusalMessages.test_account));

  const clean = cleanChanges(changes);
  if (!clean) return fail(MATRIX_REFUSALS.bad_request);

  const { data, error } = await createAdminClient().rpc("set_role_permissions", {
    p_actor_staff_id: actor.id,
    p_changes: clean,
    p_reason: reason?.slice(0, 200) ?? null,
  });
  if (error) return fail(p("Not saved. Nothing was changed.", "सहेजा नहीं गया। कुछ नहीं बदला।"));
  const result = data as { ok: boolean; reason?: string; applied?: number };
  if (!result.ok) return fail(MATRIX_REFUSALS[result.reason ?? "bad_request"] ?? MATRIX_REFUSALS.bad_request);

  revalidatePath("/staff");
  revalidatePath("/", "layout");
  const n = result.applied ?? clean.length;
  return { ok: true, message: p(`${n} ${n === 1 ? "change" : "changes"} saved · they apply at each person's next tap`, `${n} बदलाव सहेजे गए`) };
}

/** A new staff profile (no login yet). Same rules as the classic form. */
export async function addStaffAction(input: {
  displayName: string;
  shortName: string;
  role: string;
  phone: string;
  isTeaching: boolean;
  /** The language the app opens in for them; the admin picks it on Add staff. */
  preferredLanguage?: string;
}): Promise<StaffActionResult> {
  const actor = await assertPermission("staff:manage");
  await assertNotPreviewing();

  const parsed = createStaffSchema.safeParse({
    displayName: input.displayName,
    shortName: input.shortName,
    role: input.role,
    phone: input.phone,
    whatsappPhone: input.phone,
    isTeaching: input.isTeaching,
    preferredLanguage: input.preferredLanguage ?? "hi",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    let message = p("Check the details and try again.", "विवरण जाँचें।");
    try {
      const decoded = JSON.parse(first?.message ?? "") as { hi?: string; en?: string };
      if (decoded.en) message = p(decoded.en, decoded.hi);
    } catch {
      /* a built-in Zod message: keep the plain sentence */
    }
    return fail(message);
  }
  if (!rolesAssignableBy(actor.role).includes(parsed.data.role)) return fail(fromLocalized(authorityRefusalMessages.not_admin));

  const clash = await findByShortName(parsed.data.shortName);
  if (clash) return fail(p(`Short name already used by ${clash.displayName}`, `यह संक्षिप्त नाम ${clash.displayName} के पास है`));

  try {
    const created = await createStaff(parsed.data, actor.userId, { isTestAccount: actor.isTestAccount === true || (await viewingTestSession()) });
    revalidatePath("/staff");
    return { ok: true, message: p(`${created.displayName} added`, `${created.displayName} जोड़े गए`), staffId: created.id };
  } catch {
    return fail(p("Not saved. Try again.", "सहेजा नहीं गया।"));
  }
}

/**
 * Create a sign-in for a profile that has none: a Supabase Auth user with a
 * one-time password, linked to the profile. Admin only — a login is access.
 * The password is shown once to the admin and never stored or messaged.
 */
export async function createLoginAction(input: { staffId: string; email: string; role: string }): Promise<StaffActionResult> {
  const actor = await assertPermission("staff:manage");
  await assertNotPreviewing();
  if (!mayChangeAuthority(actor.role)) return fail(fromLocalized(authorityRefusalMessages.not_admin));
  if (!UUID.test(input.staffId)) return fail(p("Pick a person.", "व्यक्ति चुनें।"));
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return fail(p("Enter the email they will sign in with.", "लॉगिन ईमेल लिखें।"));
  if (!isStaffRole(input.role)) return fail(p("Pick a role.", "भूमिका चुनें।"));

  const target = await getStaffById(input.staffId);
  if (!target) return fail(fromLocalized(authorityRefusalMessages.not_found));
  if (!(await actorMayManage(actor, target.id))) return fail(fromLocalized(authorityRefusalMessages.test_account));
  if (target.userId) return fail(p(`${target.displayName} already has a login.`, `${target.displayName} का लॉगिन पहले से है।`));

  const password = tempPasswordFrom(randomBytes(16));
  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { staff_profile_id: target.id, must_change_password: true },
  });
  if (error || !created.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? "");
    return fail(taken ? p("That email already has a login.", "इस ईमेल का लॉगिन पहले से है।") : p("The login was not created.", "लॉगिन नहीं बना।"));
  }

  const { error: linkError } = await admin
    .from("staff_profiles")
    .update({ user_id: created.user.id })
    .eq("id", target.id)
    .is("user_id", null);
  if (linkError) {
    // Do not leave an account nobody can trace.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return fail(p("The login was not linked. Nothing was kept.", "लॉगिन जुड़ा नहीं।"));
  }

  if (input.role !== target.role) {
    const changed = await changeStaffAuthority({ actorStaffId: actor.id, targetStaffId: target.id, role: input.role, isActive: true, reason: "Login created" }).catch(() => null);
    if (changed && !changed.ok) {
      revalidatePath("/staff");
      return { ok: true, password, username: email, staffId: target.id, message: p(`Login created, but the role stayed ${target.role}: ${authorityRefusalMessages[changed.reason].en}`) };
    }
  }

  revalidatePath("/staff");
  return { ok: true, password, username: email, staffId: target.id, message: p(`${target.displayName} can sign in now`, `${target.displayName} अब लॉगिन कर सकते हैं`) };
}

/** A new one-time password for an existing login. Admin only. */
export async function resetPasswordAction(staffId: string): Promise<StaffActionResult> {
  const actor = await assertPermission("staff:manage");
  await assertNotPreviewing();
  if (!mayChangeAuthority(actor.role)) return fail(fromLocalized(authorityRefusalMessages.not_admin));
  if (!UUID.test(staffId)) return fail(fromLocalized(authorityRefusalMessages.not_found));
  const target = await getStaffById(staffId);
  if (!target?.userId) return fail(p("This person has no login yet.", "इनका लॉगिन नहीं है।"));
  if (!(await actorMayManage(actor, target.id))) return fail(fromLocalized(authorityRefusalMessages.test_account));
  if (target.id === actor.id) return fail(p("Change your own password from the sign-in screen.", "अपना पासवर्ड लॉगिन स्क्रीन से बदलें।"));

  const password = tempPasswordFrom(randomBytes(16));
  const { data, error } = await createAdminClient().auth.admin.updateUserById(target.userId, {
    password,
    user_metadata: { staff_profile_id: target.id, must_change_password: true },
  });
  if (error) return fail(p("The password was not reset.", "पासवर्ड नहीं बदला।"));
  revalidatePath("/staff");
  return { ok: true, password, username: data.user?.email ?? undefined, staffId: target.id, message: p("New one-time password made", "नया पासवर्ड बना") };
}

/** Turn someone's access off (records stay) or back on. Admin only, audited. */
export async function setLoginActiveAction(input: { staffId: string; active: boolean; reason?: string }): Promise<StaffActionResult> {
  const actor = await assertPermission("staff:manage");
  await assertNotPreviewing();
  if (!mayChangeAuthority(actor.role)) return fail(fromLocalized(authorityRefusalMessages.not_admin));
  if (!UUID.test(input.staffId)) return fail(fromLocalized(authorityRefusalMessages.not_found));
  const target = await getStaffById(input.staffId);
  if (!target) return fail(fromLocalized(authorityRefusalMessages.not_found));
  if (!(await actorMayManage(actor, target.id))) return fail(fromLocalized(authorityRefusalMessages.test_account));
  if (!input.active) {
    const verdict = canDeactivate(target, actor.id);
    if (!verdict.allowed) return fail(verdict.reason ? fromLocalized(verdict.reason) : p("Cannot disable this login."));
  }
  const reasonLabel = DISABLE_REASONS.find((r) => r.key === input.reason)?.label.en ?? null;
  const result = await changeStaffAuthority({ actorStaffId: actor.id, targetStaffId: target.id, role: target.role, isActive: input.active, reason: reasonLabel });
  if (!result.ok) return fail(fromLocalized(authorityRefusalMessages[result.reason]));
  revalidatePath("/staff");
  return { ok: true, message: input.active ? p(`${target.displayName} can sign in again`, `${target.displayName} फिर से लॉगिन कर सकते हैं`) : p(`${target.displayName}'s login is off · records are kept`, `${target.displayName} का लॉगिन बंद`) };
}

/** Change someone's role. Admin only, through the audited authority command. */
export async function changeRoleAction(input: { staffId: string; role: string }): Promise<StaffActionResult> {
  const actor = await assertPermission("staff:manage");
  await assertNotPreviewing();
  if (!mayChangeAuthority(actor.role)) return fail(fromLocalized(authorityRefusalMessages.not_admin));
  if (!UUID.test(input.staffId) || !isStaffRole(input.role)) return fail(p("Pick a role.", "भूमिका चुनें।"));
  const target = await getStaffById(input.staffId);
  if (!target) return fail(fromLocalized(authorityRefusalMessages.not_found));
  if (!(await actorMayManage(actor, target.id))) return fail(fromLocalized(authorityRefusalMessages.test_account));
  const result = await changeStaffAuthority({ actorStaffId: actor.id, targetStaffId: target.id, role: input.role, isActive: target.isActive, reason: "Changed on Staff & roles" });
  if (!result.ok) return fail(fromLocalized(authorityRefusalMessages[result.reason]));
  revalidatePath("/staff");
  return { ok: true, message: p("Role changed", "भूमिका बदली") };
}
