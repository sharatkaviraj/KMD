import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { hasRequiredEnvVars } from "@/platform/env";
import { resolveLanguage, type Language } from "@/platform/i18n/language";
import { createClient } from "@/platform/supabase/server";
import {
  can,
  canAny,
  resolveStaffRole,
  type StaffPermission,
  type StaffRole,
} from "@/platform/auth/permissions";

export type CurrentStaff = {
  /** `vppsone.staff_profiles.id`. */
  id: string;
  /** `auth.users.id`. Always set here — a signed-out request returns null. */
  userId: string;
  email: string | null;
  displayName: string;
  shortName: string;
  role: StaffRole;
  isTeaching: boolean;
  isActive: boolean;
  /** Which language this staff member reads the app in (D-35). */
  language: Language;
};

type StaffProfileRow = {
  id: string;
  display_name: string;
  short_name: string;
  role: string | null;
  is_teaching: boolean;
  is_active: boolean;
  preferred_language: string | null;
};

const STAFF_PROFILE_COLUMNS =
  "id, display_name, short_name, role, is_teaching, is_active, preferred_language";

/**
 * Sentinel for "signed in, but nobody has given this account a staff profile".
 *
 * It is a real state and not an error: accounts live in Supabase Auth, which
 * the fee app also uses, so any fee-app account can reach this app's login and
 * succeed. Without a profile they are not staff here, and every guard treats
 * them as signed out — but the dashboard can say *why*, which "please sign in"
 * on a page you just signed into cannot.
 */
export const NO_PROFILE = "no-profile" as const;

export type CurrentStaffResult =
  | { staff: CurrentStaff; reason: null }
  | { staff: null; reason: "signed-out" | typeof NO_PROFILE | "inactive" };

/**
 * Resolve the signed-in account to its staff profile, once per request.
 *
 * `cache()` is per-request, not cross-request: a role change or a
 * deactivation takes effect on the staff member's next navigation rather than
 * whenever a shared cache decides. The fee app trades that for a 60-second
 * data cache because it serves far more traffic; this app has a few dozen
 * users, so the simpler thing is also the correct thing.
 */
const readCurrentStaff = cache(async (): Promise<CurrentStaffResult> => {
  if (!hasRequiredEnvVars) {
    return { staff: null, reason: "signed-out" };
  }

  const supabase = await createClient();

  // getClaims() verifies the JWT locally when asymmetric signing keys are
  // configured, and falls back to a call to the auth server when they are not.
  // Same security as getUser(), without a guaranteed round trip per page.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (claimsError || !userId) {
    return { staff: null, reason: "signed-out" };
  }

  // Through the cookie client, so RLS applies: the SELECT policy on
  // staff_profiles is what permits this read. The service-role client is for
  // writes, after a permission check — not for reading your own row.
  const { data } = await supabase
    .from("staff_profiles")
    .select(STAFF_PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle<StaffProfileRow>();

  if (!data) {
    return { staff: null, reason: NO_PROFILE };
  }

  const staff: CurrentStaff = {
    id: data.id,
    userId,
    email: typeof claims?.email === "string" ? claims.email : null,
    displayName: data.display_name,
    shortName: data.short_name,
    role: resolveStaffRole(data.role),
    isTeaching: data.is_teaching,
    isActive: data.is_active,
    language: resolveLanguage(data.preferred_language),
  };

  if (!staff.isActive) {
    return { staff: null, reason: "inactive" };
  }

  return { staff, reason: null };
});

/** The staff member behind this request, or null. */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const { staff } = await readCurrentStaff();
  return staff;
}

/** Same, but says why when there is nobody — for the screen that explains it. */
export async function getCurrentStaffResult(): Promise<CurrentStaffResult> {
  return readCurrentStaff();
}

/**
 * Top of a page or a server action: there must be a staff member.
 *
 * An inactive or profile-less account is sent to `/login`, where the reason is
 * shown. `next` is preserved so the round trip lands where it started.
 */
export async function requireStaff(nextPath?: string): Promise<CurrentStaff> {
  const { staff, reason } = await readCurrentStaff();

  if (staff) {
    return staff;
  }

  const params = new URLSearchParams();
  if (nextPath) {
    params.set("next", nextPath);
  }
  if (reason && reason !== "signed-out") {
    params.set("reason", reason);
  }

  const query = params.toString();
  redirect(query ? `/login?${query}` : "/login");
}

/**
 * Top of a **page** that needs a specific permission.
 *
 * Sends the staff member to `/access-denied`, which names the permission and
 * their role — a screen they can act on, rather than the red error boundary a
 * thrown error would produce. Reaching it at all means a link was rendered
 * that should not have been, or a URL was typed.
 */
export async function requirePermission(
  permission: StaffPermission,
  nextPath?: string,
): Promise<CurrentStaff> {
  const staff = await requireStaff(nextPath);

  if (!can(staff, permission)) {
    redirect(`/access-denied?permission=${encodeURIComponent(permission)}`);
  }

  return staff;
}

export async function requireAnyPermission(
  permissions: readonly StaffPermission[],
  nextPath?: string,
): Promise<CurrentStaff> {
  const staff = await requireStaff(nextPath);

  if (!canAny(staff, permissions)) {
    redirect(`/access-denied?permission=${encodeURIComponent(permissions.join(","))}`);
  }

  return staff;
}

/**
 * Top of a **server action** that needs a permission.
 *
 * Throws rather than redirecting, and the difference matters: an action is not
 * a navigation. `redirect()` inside one works by throwing a navigation signal,
 * which a `try/catch` around the action's own logic would swallow — and a
 * swallowed guard is a guard that passed. This one cannot be mistaken for
 * success.
 */
export async function assertPermission(
  permission: StaffPermission,
): Promise<CurrentStaff> {
  const { staff } = await readCurrentStaff();

  if (!staff) {
    throw new Error("Not signed in.");
  }

  if (!can(staff, permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }

  return staff;
}
