import { redirect } from "next/navigation";

import { getCurrentStaff } from "@/platform/auth/current-staff";
import { homeFor } from "@/platform/config/navigation";

export const runtime = "nodejs";

/**
 * There is no marketing page and never will be. `/` is a doorway: the proxy
 * has already sent a signed-out visitor to `/login`, so anyone arriving here
 * has a session and wants the app.
 *
 * Which app, though, depends on who they are. A teacher's Home is her day
 * (PLAN §3), and sending her to a profile card she then has to tap past is
 * the second tap PLAN §1 asks not to exist. A session with no staff profile
 * falls through to `/dashboard`, whose guard says so properly.
 */
export default async function RootPage() {
  const staff = await getCurrentStaff();
  redirect(staff ? homeFor(staff.role) : "/dashboard");
}
