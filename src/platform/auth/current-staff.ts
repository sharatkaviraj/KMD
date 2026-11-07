import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isSmokeAccount } from "@/modules/smoke/domain/pool";
import { DAYRUN, accountForAlias } from "@/platform/auth/dayrun-policy";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { hasRequiredEnvVars } from "@/platform/env";
import { rethrowNextSignal } from "@/platform/helpers/next-signals";
import { isLanguage, resolveLanguage, type Language } from "@/platform/i18n/language";
import { createClient } from "@/platform/supabase/server";
import { readViewAsPerson, VIEW_AS_LANGUAGE_COOKIE, VIEW_AS_PERSON_COOKIE } from "@/platform/auth/view-as-cookie";
import { resolvingStaff } from "@/platform/auth/staff-resolution-context";
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
  /**
   * The start screen this account chose, as stored — a path, `app:<id>`, or
   * null for "my role's Home".
   *
   * Deliberately the raw column. It is untrusted text until
   * `resolveStart()` has checked it against the role, and resolving it here
   * would put a URL on the profile that every caller would be tempted to
   * follow without the check.
   */
  preferredStart: string | null;
  /**
   * The role's permissions as `vppsone.role_permissions` holds them now — the
   * matrix an admin edits on Staff → Roles. A failed read refuses the request;
   * it must never restore a grant an admin removed from the matrix.
   */
  permissions?: readonly string[] | null;
  /**
   * A Smoke Lab test account (D-311). `can()` withholds staff and settings
   * management from it (D-314), and the request is refused once its pass or
   * run is no longer live.
   */
  smokeLab?: boolean;
  /**
   * Fenced to test sessions (Phase 3, D-340): `staff_profiles.is_test_account`,
   * OR any account at all on a confined deployment (`isConfinedDeployment()` —
   * every Preview and local `next dev`, which point at the production
   * database), an admin included. Sees and writes TEST-2026-27 only;
   * `test-session-policy.ts` is the rule. Always set by `readCurrentStaff`;
   * optional only so hand-built fixtures stay valid (absent reads as false).
   */
  isTestAccount?: boolean;
  /** True on a confined deployment (Preview, local), for every account: the shell says so. */
  confined?: boolean;
  /**
   * Set only while an administrator sees One as this person (D-544): the
   * administrator who is looking, who is the one actually signed in. This
   * object is then the *chosen* person — their role, permissions, classes and
   * language — so every screen draws what they would see. Nothing may be
   * saved while it is set: `assertNotPreviewing()` refuses, and so do the
   * data clients themselves (`platform/supabase/view-as-guard.ts`). Anything
   * that speaks for the signed-in person to another system (the Fees bridge's
   * token) uses `viewedBy`, never this object's `userId`.
   */
  viewedBy?: CurrentStaff;
  /**
   * With `viewedBy`: the chosen person's own language. `language` is what the
   * view is shown in, which the administrator may switch without saving it.
   */
  ownLanguage?: Language;
};

type StaffProfileRow = {
  id: string;
  display_name: string;
  short_name: string;
  role: string | null;
  is_teaching: boolean;
  is_active: boolean;
  preferred_language: string | null;
  preferred_start: string | null;
  is_test_account?: boolean | null;
};

const STAFF_PROFILE_COLUMNS =
  "id, display_name, short_name, role, is_teaching, is_active, preferred_language, " +
  "preferred_start, is_test_account";

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
 *
 * Inside `resolvingStaff`: these reads answer "who is this?", so the view-as
 * lock (D-544) lets them through untouched rather than asking it again.
 */
const readSignedInStaff = cache((): Promise<CurrentStaffResult> => resolvingStaff(readSignedInStaffNow));

async function readSignedInStaffNow(): Promise<CurrentStaffResult> {
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

  // Only the six existing QA identities incur this lease check. Normal staff
  // keep the exact existing path. A missing/error lease service fails closed;
  // the database returns true for pre-existing non-launcher QA sessions.
  if (DAYRUN.aliases.some(alias => accountForAlias(alias)?.userId === userId)) {
    const { data: allowed, error } = await supabase.rpc("qa_dayrun_access_allowed");
    if (error || allowed !== true) return { staff: null, reason: "inactive" };
  }

  // Smoke Lab accounts, likewise, only while a pass and its run are live. The
  // middleware asks the same question first; this holds for anything that
  // reaches a page or an action without passing through it.
  const smokeLab = isSmokeAccount(claims);
  if (smokeLab) {
    const { data: allowed, error } = await supabase.rpc("smoke_access_allowed");
    if (error || allowed !== true) return { staff: null, reason: "inactive" };
  }

  // Through the cookie client, so RLS applies: the SELECT policy on
  // staff_profiles is what permits this read. The service-role client is for
  // writes, after a permission check — not for reading your own row.
  //
  // The permission matrix is read beside the profile, not after it:
  // `my_permissions()` keys on auth.uid(), not on the profile row, and every
  // signed-in page waits on this function, so the second round trip was paid
  // on every navigation in the app.
  const [{ data }, permissions] = await Promise.all([
    supabase
      .from("staff_profiles")
      .select(STAFF_PROFILE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle<StaffProfileRow>(),
    readMatrixPermissions(supabase),
  ]);

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
    preferredStart: data.preferred_start,
    permissions,
    ...(smokeLab ? { smokeLab: true } : {}),
    ...testAccountFlags(data.is_test_account === true),
  };

  if (!staff.isActive) {
    return { staff: null, reason: "inactive" };
  }
  if (permissions === null) {
    throw new Error("Could not verify staff permissions. Reload and try again.");
  }

  return { staff, reason: null };
}

/**
 * The staff member this request is *for*: the signed-in person, or — while an
 * administrator sees One as a chosen member of staff (D-544) — that person,
 * with `viewedBy` set to the administrator.
 *
 * Only an active administrator's request even looks at the cookie, so every
 * other account keeps the exact existing path. A cookie that does not resolve
 * (set by somebody else, a person who has left, a failed read) is ignored and
 * the administrator simply sees their own screens, which is never a leak and
 * never a write as anybody else.
 */
const readCurrentStaff = cache((): Promise<CurrentStaffResult> =>
  resolvingStaff(async () => {
    const signedIn = await readSignedInStaff();
    const actor = signedIn.staff;
    if (!actor || actor.role !== "admin" || actor.smokeLab) return signedIn;
    const chosen = readViewAsPerson(await viewAsCookieValue(VIEW_AS_PERSON_COOKIE));
    if (!chosen) return signedIn;
    try {
      const { loadViewAsSubject } = await import("@/platform/auth/view-as-subject");
      const shown = await viewAsCookieValue(VIEW_AS_LANGUAGE_COOKIE);
      const subject = await loadViewAsSubject(actor, chosen, (flag) => testAccountFlags(flag), {
        language: shown && isLanguage(shown) ? shown : null,
      });
      return subject ? { staff: subject, reason: null } : signedIn;
    } catch {
      return signedIn;
    }
  }),
);

/** A view-as cookie, or null outside a request (a cron, a test, a cached scope). */
async function viewAsCookieValue(name: string): Promise<string | null> {
  try {
    return (await cookies()).get(name)?.value || null;
  } catch (error) {
    rethrowNextSignal(error);
    return null;
  }
}

/**
 * The profile's own flag, widened by the deployment: on a confined deployment
 * every account is a test account (owner override T1, D-346). Exported for
 * the tests that pin it.
 */
export function testAccountFlags(
  profileFlag: boolean,
  env: { readonly [name: string]: string | undefined } = process.env,
): { isTestAccount: boolean; confined: boolean } {
  const confined = isConfinedDeployment(env);
  // `confined` is the deployment's, whatever the profile says: the banner tells
  // everybody on a Preview or local build — a test admin included — that this
  // build only reaches test data (tests/e2e/test-session.spec.ts).
  return { isTestAccount: profileFlag || confined, confined };
}

/**
 * The signed-in person's permissions from the editable matrix, through
 * `vppsone.my_permissions()` (security definer, own row only). A failure must
 * stop authorization, including service-role-backed actions. The seed map
 * cannot tell whether a permission has since been revoked.
 */
async function readMatrixPermissions(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<readonly string[] | null> {
  // One quick second try before refusing (perf fix 10): under database load a
  // single failed read turned a slow moment into an error page for the whole
  // request. A second failure still refuses — the deny-on-failure rule stands.
  return (await readMatrixPermissionsOnce(supabase)) ?? (await readMatrixPermissionsOnce(supabase));
}

async function readMatrixPermissionsOnce(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<readonly string[] | null> {
  try {
    if (typeof supabase.rpc !== "function") throw new Error("Permission service unavailable");
    const { data, error } = await supabase.rpc("my_permissions");
    if (error || !Array.isArray(data) || !data.every((value: unknown) => typeof value === "string")) {
      throw new Error("Permission service unavailable");
    }
    return data as string[];
  } catch {
    return null;
  }
}

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
 * The person actually signed in, never the one an administrator is looking
 * as (D-544). For the few places that must speak for the real person: the
 * view-as switch itself, its banner and log, and the Fees bridge's token.
 */
export async function getSignedInStaff(): Promise<CurrentStaff | null> {
  const { staff } = await readSignedInStaff();
  return staff;
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
export async function assertStaff(): Promise<CurrentStaff> {
  const { staff } = await readCurrentStaff();

  if (!staff) {
    throw new Error("Not signed in.");
  }

  return staff;
}

/**
 * Top of a server action that must act as the person actually signed in —
 * never the person an administrator is looking as (D-544): starting or ending
 * a view, and nothing else. Throws, like `assertStaff`, when nobody is.
 */
export async function assertSignedInStaff(): Promise<CurrentStaff> {
  const staff = await getSignedInStaff();

  if (!staff) {
    throw new Error("Not signed in.");
  }

  return staff;
}

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
