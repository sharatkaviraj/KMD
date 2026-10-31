"use server";

import type { StaffFormActionState } from "@/modules/staff-fees/data/queries";
import { requireStaffPermission } from "@/modules/fees/platform/session";

/**
 * The fees app's staff actions, refused in One (D-350, D-355). They wrote
 * `public.users` and auth users directly, with the fee role vocabulary; in One
 * the staff profile on Staff & roles (`/staff`) is the only authority and the
 * fee row is derived from it. The page redirects to `/staff`; these stay
 * exported so a stale form posting to them is told where to go instead of
 * writing a second, contradicting record.
 */
const REFUSED: StaffFormActionState = {
  status: "error",
  message: "Staff accounts are managed on Staff & roles (/staff). Nothing was changed here.",
  generatedPassword: null,
};

// Who is asking is still checked first, as in every action
// (tests/action-guards.test.ts). The fees signatures were (previous, formData)
// and (userId, previous, formData); a function that takes fewer arguments
// still fits every caller.
export async function createStaffAccountAction(): Promise<StaffFormActionState> {
  await requireStaffPermission("staff:manage");
  return REFUSED;
}

export async function updateStaffAccountAction(): Promise<StaffFormActionState> {
  await requireStaffPermission("staff:manage");
  return REFUSED;
}

export async function resetStaffPasswordAction(): Promise<StaffFormActionState> {
  await requireStaffPermission("staff:manage");
  return REFUSED;
}
