"use server";

import { changeOwnPasswordAction } from "@/app/(app)/fees/password/actions";
import { assertStaff } from "@/platform/auth/current-staff";
import { INITIAL_STAFF_FORM_ACTION_STATE } from "@/modules/staff-fees/data/queries";
import { assertNotPreviewing } from "@/vx/view-as";

/**
 * Change your own password (P11 state `password`). Your own account, so being
 * staff is the permission; not while an admin is previewing another role.
 * The work is the School Fees action: it checks the current password by
 * signing in with it, applies the 6-character rule, then `updateUser`.
 */
export async function changePasswordAction(input: { currentPassword: string; newPassword: string; confirmPassword: string }) {
  await assertStaff();
  await assertNotPreviewing();
  const fd = new FormData();
  fd.set("currentPassword", input.currentPassword);
  fd.set("newPassword", input.newPassword);
  fd.set("confirmPassword", input.confirmPassword);
  const state = await changeOwnPasswordAction(INITIAL_STAFF_FORM_ACTION_STATE, fd);
  return { ok: state.status === "success", message: state.message ?? "" };
}
