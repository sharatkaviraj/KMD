"use server";

import { setViewSessionAction } from "@/app/(app)/fees/session/actions";
import { testSessionMessages } from "@/messages/setup";
import { assertStaff } from "@/platform/auth/current-staff";
import { flat } from "@/platform/i18n/language";

/**
 * Which academic session you are looking at (P11 state `session`). A cookie on
 * your own browser — a view choice, not a write to school data — set by the
 * School Fees session action the shell's session pill uses.
 */
export async function pickSessionAction(label: string) {
  const staff = await assertStaff();
  try {
    const res = await setViewSessionAction(label);
    if (!res.success) {
      // A session this person may not open (Phase 3): the cookie is unchanged.
      return { ok: false as const, message: flat(testSessionMessages.sessionRefused, staff.language) };
    }
    return { ok: true as const, sessionLabel: res.sessionLabel };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Could not switch the session." };
  }
}
