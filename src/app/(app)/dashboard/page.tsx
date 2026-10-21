import { redirect } from "next/navigation";

import { MENU_HOME } from "@/vx/nav";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

/**
 * `/dashboard` — the old home, still where sign-in and old bookmarks land.
 *
 * It told a teacher "open fees, collection and timetable here" though she can
 * open no fees, listed screens outside her menu and showed her login e-mail
 * (smoke run, 20 Oct). It now forwards to the home of the menu the person
 * sees. Straight to the menu home, not through `/`: a start screen saved as
 * "/dashboard" would otherwise send `/` back here.
 */
export default async function DashboardPage(): Promise<never> {
  const { menu } = await getViewer();
  redirect(MENU_HOME[menu]);
}
