import "server-only";

import { m } from "@/messages";
import { resolveStaffRole, type StaffRole } from "@/platform/auth/permissions";
import { resolveLanguage, type Localized } from "@/platform/i18n/language";
import { writeLanguageCookie } from "@/platform/i18n/language-cookie";
import type { createClient } from "@/platform/supabase/server";

/** The cookie client, which is typed to the `vppsone` schema rather than `public`. */
type VppsClient = Awaited<ReturnType<typeof createClient>>;

/**
 * What has to be true after Supabase says who somebody is.
 *
 * Proving an identity to Supabase only proves this is an account in the pool
 * the fee app also uses. Being staff *here* is a `vppsone.staff_profiles` row,
 * and not having one is a normal thing to be — a parent with a fee-app login,
 * somebody who left. So every way in runs the same two checks and writes the
 * same language cookie, in one place rather than once per entrance: the day a
 * second door was added is the day the first one's rules could start drifting.
 *
 * On refusal the caller is signed straight back out, because a session with no
 * profile can reach nothing and would otherwise sit in the browser looking
 * like a login that worked.
 */
export async function admitSignedInUser(
  supabase: VppsClient,
  userId: string,
): Promise<
  | { ok: true; staff: { role: StaffRole; preferredStart: string | null } }
  | { ok: false; message: Localized }
> {
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("role, is_active, preferred_language, preferred_start")
    .eq("user_id", userId)
    .maybeSingle<{
      role: string | null;
      is_active: boolean;
      preferred_language: string | null;
      preferred_start: string | null;
    }>();

  if (!profile) {
    await supabase.auth.signOut();
    return { ok: false, message: m.noProfileAskAdmin };
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return { ok: false, message: m.accountInactiveAskAdmin };
  }

  // Sign-in is where the account's language meets this device. The cookie is
  // what lets the *login* screen speak the right language next time, since at
  // that point there is no profile to read (D-36).
  await writeLanguageCookie(resolveLanguage(profile.preferred_language));

  // The role travels back with the admission, because both doors have to send
  // this person somewhere and only one Home is right for them (PLAN section 3).
  // Reading it a second time in the caller would be a second query and a second
  // chance to disagree about who just signed in.
  return {
    ok: true,
    staff: {
      role: resolveStaffRole(profile.role),
      // Unchecked, as stored. `landingFor()` resolves it against the role
      // before anybody is sent anywhere.
      preferredStart: profile.preferred_start,
    },
  };
}
