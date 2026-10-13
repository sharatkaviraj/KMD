"use server";

import { changeOwnPasswordAction } from "@/app/(app)/fees/password/actions";
import { assertStaff } from "@/platform/auth/current-staff";
import { createClient } from "@/platform/supabase/server";
import { INITIAL_STAFF_FORM_ACTION_STATE } from "@/modules/staff-fees/data/queries";
import { assertNotPreviewing } from "@/vx/view-as";

/**
 * Change your own password (P11 state `password`). Your own account, so being
 * staff is the permission; not while an admin is previewing another role.
 * The work is the School Fees action: it checks the current password by
 * signing in with it, applies the 6-character rule, then `updateUser`.
 *
 * Once it has worked, the "temporary password" mark an admin's reset left on
 * the account (`must_change_password`) is taken off, so the screen stops
 * calling the new one temporary. That is the only extra write, and a failure
 * there never undoes the change.
 */
export async function changePasswordAction(input: { currentPassword: string; newPassword: string; confirmPassword: string }) {
  await assertStaff();
  await assertNotPreviewing();
  const fd = new FormData();
  fd.set("currentPassword", input.currentPassword);
  fd.set("newPassword", input.newPassword);
  fd.set("confirmPassword", input.confirmPassword);
  const state = await changeOwnPasswordAction(INITIAL_STAFF_FORM_ACTION_STATE, fd);
  const ok = state.status === "success";
  if (ok) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user?.user_metadata?.must_change_password === true) {
        await supabase.auth.updateUser({ data: { must_change_password: false } });
      }
    } catch {
      // The password is changed; the mark only decides a label.
    }
  }
  return { ok, message: state.message ?? "" };
}
