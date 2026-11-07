import "server-only";

import { resolveLanguage, type Language } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveStaffRole } from "@/platform/auth/permissions";
import type { ViewAsPersonCookie } from "@/platform/auth/view-as-cookie";
import type { CurrentStaff } from "@/platform/auth/current-staff";

/**
 * The member of staff an administrator has chosen to see One as (D-544),
 * built into the same `CurrentStaff` every screen already reads — so Today,
 * the register, the marks sheet and the menu are drawn from *their* profile,
 * *their* role's permissions and *their* classes, with no screen written
 * twice. `viewedBy` carries the administrator who is looking; while it is set
 * every write refuses (`view-as-guard.ts`, `assertNotPreviewing()`).
 *
 * Loaded only after `current-staff.ts` has verified the signed-in person as an
 * active administrator, through the service role: the chosen person's profile
 * is not something the administrator's own RLS session is asked to read.
 *
 * The cookie alone is never enough. The administrator must also hold an open,
 * unexpired `vppsone.view_as_log` row for this person — the same row the
 * database checks before it answers a row-security read as them
 * (`vppsone.view_as_subject_id()`, migration 20261107164847). So ending the
 * view in the database ends it everywhere, even if a cookie were left behind.
 */

/**
 * The auth id given to somebody who has no One sign-in yet. Most of the
 * school's teachers are in that state, and an administrator may still want to
 * see what they will see. The nil uuid matches no row, so anything keyed on
 * the sign-in reads nothing rather than somebody else's.
 */
export const NO_SIGN_IN_USER_ID = "00000000-0000-0000-0000-000000000000";

type SubjectRow = {
  id: string;
  user_id: string | null;
  display_name: string;
  short_name: string;
  role: string | null;
  is_teaching: boolean;
  is_active: boolean;
  preferred_language: string | null;
  preferred_start: string | null;
  is_test_account: boolean | null;
};

const SUBJECT_COLUMNS =
  "id, user_id, display_name, short_name, role, is_teaching, is_active, preferred_language, preferred_start, is_test_account";

/**
 * Who an administrator may be shown as. Never themselves, never another
 * administrator (their screens are the administrator's own), never somebody
 * inactive. A test account looks only at test accounts, so a QA key never
 * opens a real person's screens. A real administrator may look at real staff
 * and at the practice accounts, whose screens only ever show TEST data — the
 * school has no real academic or exam coordinator yet, and those are the
 * screens the owner most wants to see. `vppsone.view_as_begin()` asks the
 * same questions.
 */
export function mayViewAs(
  actor: { id: string; role: string; isActive: boolean; isTestAccount?: boolean; smokeLab?: boolean },
  subject: { id: string; role: string | null; is_active: boolean; is_test_account: boolean | null },
): boolean {
  if (actor.role !== "admin" || !actor.isActive || actor.smokeLab) return false;
  if (subject.id === actor.id || !subject.is_active) return false;
  if (resolveStaffRole(subject.role) === "admin") return false;
  if (actor.isTestAccount === true && subject.is_test_account !== true) return false;
  return true;
}

export async function loadViewAsSubject(
  actor: CurrentStaff,
  cookie: ViewAsPersonCookie,
  testAccountFlags: (profileFlag: boolean) => { isTestAccount: boolean; confined: boolean },
  options: { language?: Language | null } = {},
): Promise<CurrentStaff | null> {
  if (cookie.actorUserId !== actor.userId.toLowerCase()) return null;
  if (cookie.subjectId === actor.id) return null;

  const db = createAdminClient();
  const [{ data: row, error }, { data: open, error: logError }] = await Promise.all([
    db.from("staff_profiles").select(SUBJECT_COLUMNS).eq("id", cookie.subjectId).maybeSingle<SubjectRow>(),
    db
      .from("view_as_log")
      .select("id")
      .eq("actor_user_id", actor.userId)
      .eq("subject_staff_id", cookie.subjectId)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .returns<{ id: string }[]>(),
  ]);
  if (error || !row || !mayViewAs(actor, row)) return null;
  if (logError || !Array.isArray(open) || open.length === 0) return null;

  const role = resolveStaffRole(row.role);
  const ownLanguage = resolveLanguage(row.preferred_language);
  // The matrix as the chosen person's role holds it now, exactly what
  // `vppsone.my_permissions()` would answer them. A failed read shows nothing
  // rather than guessing a set.
  const { data: grants, error: grantError } = await db
    .from("role_permissions")
    .select("permission")
    .eq("role", role)
    .returns<{ permission: string }[]>();
  if (grantError || !Array.isArray(grants)) return null;

  return {
    id: row.id,
    userId: row.user_id ?? NO_SIGN_IN_USER_ID,
    email: null,
    displayName: row.display_name,
    shortName: row.short_name,
    role,
    isTeaching: row.is_teaching,
    isActive: row.is_active,
    // Their language, as they would read it, unless the administrator has
    // switched this view to another (`VIEW_AS_LANGUAGE_COOKIE`). The banner
    // speaks the administrator's own (`viewedBy.language`).
    language: options.language ?? ownLanguage,
    ownLanguage,
    preferredStart: row.preferred_start,
    permissions: grants.map((grant) => grant.permission),
    // A test administrator stays fenced to TEST whoever they look as, and a
    // practice account's screens are TEST screens whoever looks.
    ...testAccountFlags(row.is_test_account === true || actor.isTestAccount === true),
    viewedBy: actor,
  };
}
