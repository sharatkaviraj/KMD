"use server";

import { setViewSessionAction } from "@/app/(app)/fees/session/actions";
import { assertStaff } from "@/platform/auth/current-staff";

/**
 * Which academic session you are looking at (P11 state `session`). A cookie on
 * your own browser — a view choice, not a write to school data — set by the
 * School Fees session action the shell's session pill uses.
 */
export async function pickSessionAction(label: string) {
  await assertStaff();
  try {
    const res = await setViewSessionAction(label);
    return { ok: true as const, sessionLabel: res.sessionLabel };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Could not switch the session." };
  }
}
