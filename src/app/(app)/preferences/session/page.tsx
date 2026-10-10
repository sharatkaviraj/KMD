import { requireStaff } from "@/platform/auth/current-staff";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { getSessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { MENU_HOME, MENU_LABEL, ROLE_PREVIEW_MENUS } from "@/vx/nav";
import { lead } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";

import { SessionPicker } from "@/vx/screens/system/session-picker";

export const runtime = "nodejs";

/**
 * Preferences → Session (P11 state `session`): the academic year you are
 * looking at, and for the administrator the read-only "see the app as".
 */
export default async function SessionPage() {
  const staff = await requireStaff("/preferences/session");
  const lang = staff.language;
  const [{ previewing }, switcher, cookie] = await Promise.all([
    getViewer(),
    getSessionSwitcherData().catch(() => ({ activeSessionLabel: "", availableSessions: [] })),
    getViewSessionCookie(),
  ]);
  const sessions = switcher.availableSessions.map((s) => ({ label: s.session_label, current: s.is_current, status: s.status }));
  const viewing = cookie && sessions.some((s) => s.label === cookie) ? cookie : switcher.activeSessionLabel;
  const roles = staff.role === "admin" ? ROLE_PREVIEW_MENUS.map((m) => ({ menu: m, label: MENU_LABEL[m], home: MENU_HOME[m] })) : null;

  return (
    <VxPage>
      <TopBar crumb={lead({ en: "Preferences", hi: "पसंद" }, lang)} title={lead({ en: "Session and view", hi: "सत्र और दृश्य" }, lang)} mBack="/preferences" />
      <main>
        <Section>
          <SessionPicker sessions={sessions} viewing={viewing} roles={roles} previewing={previewing} />
        </Section>
      </main>
    </VxPage>
  );
}
