import { requireStaff } from "@/platform/auth/current-staff";
import { createClient } from "@/platform/supabase/server";
import { getStaffById } from "@/modules/staff/data/staff-repo";

import { PasswordScreen } from "@/vx/screens/system/password-screen";

export const runtime = "nodejs";

/**
 * Preferences → Password (P11 state `password`). Every account, its own
 * password. After an admin made or reset the login (`must_change_password`
 * on the account, Staff → Users), the screen says it is a temporary one.
 */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const staff = await requireStaff("/preferences/password");
  const [temporary, me] = await Promise.all([
    createClient()
      .then((supabase) => supabase.auth.getUser())
      .then(({ data }) => data.user?.user_metadata?.must_change_password === true)
      .catch(() => false),
    getStaffById(staff.id).catch(() => null),
  ]);
  // Opened from the teacher app's My profile, Back returns there (smoke 6 Nov, teacher 19).
  const back = (await searchParams).from === "teach" ? "/teach/more?view=profile" : "/preferences";
  return <PasswordScreen language={staff.language} temporary={temporary} phone={me?.phone ?? me?.whatsappPhone ?? null} back={back} />;
}
