import "server-only";

import { redirect } from "next/navigation";

import { feePermissionsFor, feeRoleFor } from "@/platform/auth/fee-roles";
import { can } from "@/platform/auth/permissions";
import {
  getCurrentStaff,
  requirePermission,
  type CurrentStaff,
} from "@/platform/auth/current-staff";
import { feeLocaleFor } from "@/platform/i18n/bridge";
import {
  hasRolePermission,
  type StaffPermission,
  type StaffRole,
} from "@/modules/fees/platform/roles";

/**
 * The adapter that let ~600 files of fee code move without being rewritten.
 *
 * The ported code asks `requireAuthenticatedStaff()` who is signed in about
 * ninety times, and every fee guard reads the answer. Rather than edit ninety
 * call sites — and with them the guard inside every fee screen — this file
 * keeps the fee app's function names and shapes and answers them from VPPS
 * One's own session.
 *
 * The fee app's version of this file read `public.users` for the role and
 * cached it for sixty seconds. This one does not exist: **the role comes from
 * `vppsone.staff_profiles`, which is D-6 and did not change because the fee
 * app moved in.** `public.users.role` is not consulted, so the two records
 * cannot disagree — there is only one.
 *
 * `getCurrentStaff()` is already wrapped in React `cache()`, so this costs
 * nothing per call beyond the first.
 */

export type StaffAuthClaims = Record<string, unknown> & {
  id?: string;
  email?: string;
  role?: string;
  sub?: string;
};

export type AuthenticatedStaffSession = StaffAuthClaims & {
  /**
   * `auth.users.id`, and **not optional**, which is the one place this type
   * deliberately differs from the fee app's.
   *
   * There it was optional because the session was a JWT-claims bag that might
   * not carry one. Here it is built from a resolved staff profile, so it is
   * always present — and saying so is what lets the dashboard pass it straight
   * to a query instead of re-narrowing a value that cannot be undefined.
   */
  id: string;
  appRole: StaffRole;
  permissions: readonly StaffPermission[];
  isActive: boolean;
  fullName: string | null;
  lastLoginAt: string | null;
  /** The fee app's locale for this reader, resolved from their account. */
  preferredLocale: string | null;
  /** A Smoke Lab test account: never manages staff accounts (D-314). */
  smokeLab?: boolean;
};

/** Fee permissions a Smoke Lab account never has, whatever its role (D-314). */
const SMOKE_LAB_DENIED_FEE: readonly string[] = ["staff:manage"];

function allowedFor(staff: Pick<AuthenticatedStaffSession, "appRole" | "smokeLab">, permission: StaffPermission) {
  if (staff.smokeLab && SMOKE_LAB_DENIED_FEE.includes(permission)) return false;
  return hasRolePermission(staff.appRole, permission);
}

/**
 * `satisfies`, not a return-type annotation.
 *
 * `AuthenticatedStaffSession` types `id` as optional, because it extends the
 * fee app's loose JWT-claims bag. Annotating the return type would widen
 * `id` to `string | undefined` at every one of the ~90 call sites — and the
 * dashboard, which passes it straight to a query, would stop compiling for a
 * value that is in fact always there. Letting the literal type through keeps
 * the shape checked and the narrowing intact.
 */
function toFeeSession(staff: CurrentStaff) {
  return {
    id: staff.userId,
    sub: staff.userId,
    email: staff.email ?? undefined,
    appRole: feeRoleFor(staff.role),
    permissions: feePermissionsFor(staff.role),
    isActive: staff.isActive,
    fullName: staff.displayName,
    // The fee app used this only to show "last seen" on its staff screen.
    // VPPS One does not track it, and inventing a timestamp would be worse
    // than admitting there isn't one.
    lastLoginAt: null,
    preferredLocale: feeLocaleFor(staff.language),
    smokeLab: staff.smokeLab === true,
  } satisfies AuthenticatedStaffSession;
}

export async function getAuthenticatedStaff(): Promise<AuthenticatedStaffSession | null> {
  const staff = await getCurrentStaff();
  return staff && can(staff, "fees:view") ? toFeeSession(staff) : null;
}

/**
 * The fee app defaulted this to its own `/auth/login`. There is one door here
 * and the native permission guard knows where it is, so the parameter is only the
 * path to come back to — kept so the ported call sites that pass one still
 * compile, and so a deep link survives the round trip through sign-in.
 */
export async function requireAuthenticatedStaff(
  redirectTo?: string,
): Promise<AuthenticatedStaffSession> {
  // The page and its layout can execute concurrently. Enforce native fee
  // access here before a ported guard can grant its broader read-only role.
  // `requirePermission()` already redirects a signed-out, profile-less or
  // deactivated account to /login with the reason attached — a better screen
  // than the fee app's bare redirect, so the explicit isActive check the fee
  // version needed is not repeated here.
  const staff = await requirePermission("fees:view", redirectTo);
  return toFeeSession(staff);
}

export function staffCan(
  staff: Pick<AuthenticatedStaffSession, "appRole" | "smokeLab">,
  permission: StaffPermission,
) {
  return allowedFor(staff, permission);
}

type PermissionGuardOptions = {
  onDenied?: "throw" | "redirect";
  redirectTo?: string;
};

function getAccessDeniedHref(permission: string) {
  return `/access-denied?permission=${encodeURIComponent(permission)}`;
}

export async function requireStaffPermission(
  permission: StaffPermission,
  options: PermissionGuardOptions = {},
) {
  const staff = await requireAuthenticatedStaff();

  if (allowedFor(staff, permission)) {
    return staff;
  }

  if (options.onDenied === "redirect") {
    redirect(options.redirectTo ?? getAccessDeniedHref(permission));
  }

  throw new Error(`You do not have permission: ${permission}`);
}

export async function requireAnyStaffPermission(
  permissions: readonly StaffPermission[],
  options: PermissionGuardOptions = {},
) {
  const staff = await requireAuthenticatedStaff();

  if (permissions.some((permission) => allowedFor(staff, permission))) {
    return staff;
  }

  if (options.onDenied === "redirect") {
    redirect(options.redirectTo ?? getAccessDeniedHref(permissions.join(",")));
  }

  throw new Error(
    `You do not have any required permissions: ${permissions.join(", ")}`,
  );
}

export function hasStaffPermission(
  staff: Pick<AuthenticatedStaffSession, "appRole" | "smokeLab">,
  permission: StaffPermission,
) {
  return allowedFor(staff, permission);
}

export function hasAnyStaffPermission(
  staff: Pick<AuthenticatedStaffSession, "appRole" | "smokeLab">,
  permissions: readonly StaffPermission[],
) {
  return permissions.some((permission) => allowedFor(staff, permission));
}

/*
 * The fee app's cache plumbing, kept as no-ops so ported call sites compile.
 *
 * `STAFF_PROFILES_TAG` and `staffProfileTag()` existed to bust a 60-second
 * cache of `public.users`. There is no such cache here — `getCurrentStaff()`
 * is per-request — so revalidating these tags is harmless and correct: the
 * next navigation reads the profile again anyway.
 */
export const STAFF_PROFILE_REVALIDATE_SECONDS = 0;
export const STAFF_PROFILES_TAG = "staff-profiles";

export function staffProfileTag(userId: string) {
  return `staff:${userId}`;
}
