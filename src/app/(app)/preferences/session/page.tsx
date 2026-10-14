import { requireStaff } from "@/platform/auth/current-staff";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { getSessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { homeForRole, MENU_HOME, MENU_LABEL, ROLE_PREVIEW_MENUS } from "@/vx/nav";
import { getViewer } from "@/vx/view-as";

import { SessionScreen } from "@/vx/screens/system/session-screen";

export const runtime = "nodejs";

/**
 * Preferences → Session (P11 state `session`): the academic year you are
 * looking at, and for the administrator the read-only "see the app as".
 */
export default async function SessionPage() {
  const staff = await requireStaff("/preferences/session");
  const [{ previewing }, switcher, cookie] = await Promise.all([
    getViewer(),
    getSessionSwitcherData().catch(() => ({ activeSessionLabel: "", availableSessions: [] })),
    getViewSessionCookie(),
  ]);
  const sessions = switcher.availableSessions.map((s) => ({ label: s.session_label, current: s.is_current, status: s.status }));
  const viewing = cookie && sessions.some((s) => s.label === cookie) ? cookie : switcher.activeSessionLabel;
  const roles = staff.role === "admin" ? ROLE_PREVIEW_MENUS.map((m) => ({ menu: m, label: MENU_LABEL[m], home: MENU_HOME[m] })) : null;

  return (
    <SessionScreen
      language={staff.language}
      name={staff.shortName || staff.displayName}
      sessions={sessions}
      viewing={viewing}
      roles={roles}
      previewing={previewing}
      home={homeForRole(staff.role)}
    />
  );
}
