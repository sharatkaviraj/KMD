import { approvedStaffPhotos } from "@/modules/collection/data/approved-photos";
import { assistFeaturesFor } from "@/modules/assist/data/settings";
import { Suspense, type ReactNode } from "react";

import { getDuesBadgeCount } from "@/modules/dashboard/data/shell-metrics";
import { pendingMoneyRequests } from "@/modules/dashboard/vx/admin-today";
import { SessionSwitchingProvider } from "@/modules/fees/platform/session-context/switching-context";
import { can, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { CACHE_TAGS, sharedCache } from "@/platform/performance/shared-cache";
import { OfficeSyncListener } from "@/ui/shell/office-sync-listener";
import { RouteProgress } from "@/ui/shell/route-progress";
import { SessionSwitchOverlayMount } from "@/ui/shell/session-switch-overlay";
import { createAdminClient } from "@/platform/supabase/admin";
import { initials, schoolToday } from "@/vx/format";
import { inboxCount } from "@/vx/screens/admin/data";
import { schoolMinutes } from "@/vx/screens/admin/logic";
import { schoolNow } from "@/platform/auth/qa-clock";
import { bottomFor, groupsFor, MENU_HOME, MENU_LABEL, PREVIEW_LABEL, ROLE_PREVIEW_MENUS } from "@/vx/nav";
import { lead } from "@/vx/text";
import { NavTrail } from "@/vx/ui/back-link";
import { avatarColor } from "@/vx/ui/primitives";
import { ToastProvider } from "@/vx/ui/overlays";
import { previewPermissions, type Viewer } from "@/vx/view-as";
import { OfflineBanner } from "@/vx/screens/system/offline-banner";
import { SessionExpiredSheet } from "@/vx/screens/system/session-expired";
import { UpdateBanner } from "@/vx/screens/system/update-banner";
import type { SessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { testSessionMessages } from "@/messages/setup";
import { flat } from "@/platform/i18n/language";

import { AssistProvider } from "@/vx/assist/context";

import { VxBottomBar } from "./bottom-bar";
import { LazySearchPalette } from "./lazy";
import type { PaletteItem } from "./palette";
import { PreviewBanner } from "./preview-banner";
import { SessionBar } from "./session-bar";
import { menuRoleLabel, ROLE_SUB } from "./role-line";
import { VxSidebar, type Badges } from "./sidebar";

const PREVIEW_ICON = { teacher: "grad", accountant: "rupee", academic: "trend", exam: "award" } as const;

/**
 * Where the person at the foot of the sidebar leads: their own settings, as
 * the design links it (admin → Settings, teacher → More, the others → their
 * Menu, which holds dark mode, Hindi labels, session, password and sign out).
 */
function meHref(role: StaffRole, settings: boolean): string {
  if (settings) return "/settings";
  if (role === "teacher") return "/teach/more";
  return "/menu";
}

async function loadBadges(viewer: Viewer, sessionLabel: string): Promise<Badges> {
  const out: Badges = {};
  const [dues, inbox] = await Promise.all([
    can(viewer.staff, "fees:view") && sessionLabel ? getDuesBadgeCount(sessionLabel) : null,
    // The admin queue, counted from the same reads the Needs you page uses —
    // in the same request on Today and Needs you, so it is free there (perf fixes 1, 2).
    !viewer.previewing && can(viewer.staff, "attendance:correct") && sessionLabel
      ? schoolNow(viewer.staff)
          // The badge reads the reader's clock, as Needs you itself does, so a
          // lab seat never sees a count the list disagrees with (smoke 20 Oct).
          .then((now) => inboxCount(viewer.staff, sessionLabel, schoolToday(now), can(viewer.staff, "fees:view") ? pendingMoneyRequests : undefined, schoolMinutes(now)))
          .catch(() => null)
      : null,
  ]);
  if (dues !== null) out.dues = dues;
  if (inbox !== null) out.inbox = inbox;
  return out;
}

/**
 * "Large text" from Settings or the teacher's More tab, applied to every screen.
 *
 * Every full load and every refresh waited on this read before drawing the
 * frame (perf fix 10). Cached per staff id — the id is the key, so nobody
 * gets another person's setting — and both places that save it expire the tag.
 */
const prefersLargeText = sharedCache(
  async (staffProfileId: string): Promise<boolean> => {
    const { data, error } = await createAdminClient()
      .from("staff_ui_preferences")
      .select("large_text")
      .eq("staff_profile_id", staffProfileId)
      .maybeSingle<{ large_text: boolean }>();
    if (error) throw new Error(error.message);
    return data?.large_text === true;
  },
  ["vx-large-text"],
  { tags: [CACHE_TAGS.uiPrefs], revalidate: 300 },
);

/**
 * The one frame every signed-in screen sits in (PLAN A.5, docs/ui/DECISIONS.md
 * UI-8): sidebar from 900px, bottom bar below it, the search palette, toasts
 * and the overlay layer. Screens draw their own top bar inside `VxPage`.
 */
export async function VxShell({
  viewer,
  sessionLabel,
  sessionIsTest,
  sessionPill = null,
  rosterStatus,
  children,
}: {
  viewer: Viewer;
  sessionLabel: string;
  sessionIsTest: boolean;
  /** The session pill, for a viewer allowed to switch (layout decides); null hides it. */
  sessionPill?: { showLive: boolean; sessions: Promise<SessionSwitcherData> } | null;
  rosterStatus?: ReactNode;
  children: ReactNode;
}) {
  const { staff, menu, previewing } = viewer;
  // Both reads at once: every full page load waits on this frame.
  const [previewPerms, large] = await Promise.all([
    previewing ? previewPermissions(previewing) : Promise.resolve(null),
    prefersLargeText(staff.id).catch(() => false),
  ]);
  const allowed = (p: StaffPermission) => (previewPerms ? previewPerms.has(p) : can(staff, p));
  // The AI helper's features for this person (D-324); none at all without the school's Claude key.
  const assist = await assistFeaturesFor(staff, previewPerms ? allowed : undefined).catch(() => []);

  const groups = groupsFor(menu, allowed);
  const tabs = bottomFor(menu, allowed);
  const badges = loadBadges(viewer, sessionLabel);
  const fees = can(staff, "fees:view");

  // A rehearsal session says so on the role line, which is where the session is named now.
  const testMark = sessionIsTest && !/test/i.test(sessionLabel) ? " · test" : "";
  const roleLine = `${menuRoleLabel(menu, staff.role, previewing).en}${sessionLabel ? ` · ${sessionLabel.replace("-", "–")}${testMark}` : ""}`;
  const settings = can(staff, "settings:manage");
  const portrait = await approvedStaffPhotos([staff.id]).catch(() => new Map<string,string>());
  const me = {
    photo: portrait.get(staff.id) ?? null,
    initials: initials(staff.displayName),
    name: staff.displayName,
    sub: lead(ROLE_SUB[staff.role], staff.language),
    href: meHref(staff.role, settings),
    color: avatarColor(staff.displayName),
  };
  const previewMenus =
    staff.role === "admin"
      ? ROLE_PREVIEW_MENUS.filter((m): m is Exclude<typeof m, "admin"> => m !== "admin").map((m) => ({ key: m, label: PREVIEW_LABEL[m], icon: PREVIEW_ICON[m] }))
      : [];

  const palette: PaletteItem[] = groups.flatMap((g) =>
    g.items.map((i) => ({ label: i.label, icon: i.icon, href: i.href, group: g.title?.en ?? "" })),
  );

  return (
    <SessionSwitchingProvider>
      <ToastProvider>
        <AssistProvider features={assist}>
        <Suspense fallback={null}>
          <RouteProgress />
          <NavTrail />
          {fees ? <OfficeSyncListener sessionLabel={sessionLabel} /> : null}
        </Suspense>
        <a href="#vx-main" className="vx-skip">Skip to content</a>
        <div className={`vxt vx-shell${large ? " vx-large" : ""}`}>
          <VxSidebar
            groups={groups}
            me={me}
            roleLine={roleLine}
            sessionHref={fees ? "/preferences/session" : undefined}
            home={MENU_HOME[menu]}
            badges={badges}
            teacherSized={menu === "teacher"}
            previewMenus={previewMenus}
            previewing={previewing}
          />
          <div className="vx-content">
            <OfflineBanner />
            <SessionSwitchOverlayMount />
            {previewing ? <PreviewBanner label={MENU_LABEL[previewing].en} /> : null}
            {staff.confined ? (
              // A Preview or local deployment on the production database:
              // everybody is fenced to TEST here, an admin included (D-346).
              <div className="vx-confined" role="status">{flat(testSessionMessages.confinedBanner, staff.language)}</div>
            ) : null}
            {sessionPill || rosterStatus ? <div className="vx-workspace-bar">
              {rosterStatus ?? <span className="vx-workspace-label">{flat({ en: "Academic session", hi: "शैक्षणिक सत्र" }, staff.language)}</span>}
              {sessionPill ? <SessionBar label={sessionLabel} isTest={sessionIsTest} showLive={sessionPill.showLive} sessions={sessionPill.sessions} /> : null}
            </div> : null}
            <main id="vx-main" className="vx-main vx-reset">
              {children}
            </main>
          </div>
          <VxBottomBar tabs={tabs} badges={badges} />
        </div>
        <LazySearchPalette items={palette} />
        <UpdateBanner />
        <SessionExpiredSheet />
        <div id="vx-layer" className="vxt vx-layer" />
        </AssistProvider>
      </ToastProvider>
    </SessionSwitchingProvider>
  );
}
