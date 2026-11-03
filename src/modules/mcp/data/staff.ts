import "server-only";

import { testAccountFlags } from "@/platform/auth/current-staff";
import { DAYRUN, accountForAlias } from "@/platform/auth/dayrun-policy";
import { resolveStaffRole } from "@/platform/auth/permissions";
import type { VerifiedActor } from "@/platform/auth/verified-actor";
import { resolveLanguage } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";

type StaffForUserRow = {
  id: string;
  display_name: string;
  short_name: string;
  role: string | null;
  is_teaching: boolean;
  is_active: boolean;
  preferred_language: string | null;
  is_test_account: boolean | null;
  permissions: unknown;
};

/**
 * Step 4 of every AI-connection call (plan §5.3): the staff profile for the
 * connection's auth user, and its role's permissions from the matrix as they
 * are now — the same rules `readCurrentStaff` applies to a cookie:
 *
 *  - no profile → null; the caller refuses and revokes;
 *  - `is_active` is returned as stored; the caller refuses and revokes;
 *  - the role is narrowed with `resolveStaffRole` (unknown → view_only);
 *  - a confined deployment makes every account a test account
 *    (`testAccountFlags`, `isConfinedDeployment`);
 *  - a matrix that cannot be read refuses the call (throws), never falls
 *    back to the seed map.
 *
 * Read on every call through `vppsone.ai_staff_for_user` (service role:
 * `my_permissions()` keys on auth.uid(), which a token call has not got).
 * Nothing is cached.
 */
export async function resolveStaffForUser(userId: string): Promise<VerifiedActor | null> {
  const { data, error } = await createAdminClient().rpc("ai_staff_for_user", { p_user_id: userId });
  if (error) throw new Error("Could not read the staff profile.");
  if (!data) return null;

  const row = data as StaffForUserRow;
  const permissions = row.permissions;
  if (!Array.isArray(permissions) || !permissions.every((value) => typeof value === "string")) {
    throw new Error("Could not verify staff permissions.");
  }

  return {
    id: row.id,
    userId,
    email: null,
    displayName: row.display_name,
    shortName: row.short_name,
    role: resolveStaffRole(row.role),
    isTeaching: row.is_teaching,
    isActive: row.is_active === true,
    language: resolveLanguage(row.preferred_language),
    preferredStart: null,
    permissions: permissions as string[],
    ...testAccountFlags(row.is_test_account === true),
    qaAccount: DAYRUN.aliases.some((alias) => accountForAlias(alias)?.userId === userId),
    verifiedBy: "ai_connection",
  };
}
