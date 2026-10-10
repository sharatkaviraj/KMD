import { Suspense, type ReactNode } from "react";

import { getShellPulse } from "@/modules/dashboard/data/shell-metrics";
import { getSessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { SessionSwitchingProvider } from "@/modules/fees/platform/session-context/switching-context";
import { can, type StaffPermission } from "@/platform/auth/permissions";
import { OfficeSyncListener } from "@/ui/shell/office-sync-listener";
import { RouteProgress } from "@/ui/shell/route-progress";
import { SessionSwitchOverlayMount } from "@/ui/shell/session-switch-overlay";
import { ShellSessionPill, ShellSessionPillSkeleton } from "@/ui/shell/shell-session-pill";
import { createAdminClient } from "@/platform/supabase/admin";
import { initials, schoolToday } from "@/vx/format";
import { loadInbox } from "@/vx/screens/admin/data";
import { bottomFor, groupsFor, MENU_HOME, MENU_LABEL, ROLE_PREVIEW_MENUS } from "@/vx/nav";
import { avatarColor } from "@/vx/ui/primitives";
import { ToastProvider } from "@/vx/ui/overlays";
import { previewPermissions, type Viewer } from "@/vx/view-as";
import { OfflineBanner } from "@/vx/screens/system/offline-banner";
import { SessionExpiredSheet } from "@/vx/screens/system/session-expired";
import { UpdateBanner } from "@/vx/screens/system/update-banner";

import { VxBottomBar } from "./bottom-bar";
import { LazySearchPalette } from "./lazy";
import type { PaletteItem } from "./palette";
import { PreviewBanner } from "./preview-banner";
import { VxSidebar, type Badges } from "./sidebar";

const PREVIEW_ICON = { teacher: "grad", accountant: "rupee", academic: "trend", exam: "award" } as const;

async function loadBadges(viewer: Viewer, sessionLabel: string): Promise<Badges> {
  const out: Badges = {};
  const [pulse, inbox] = await Promise.all([
    can(viewer.staff, "fees:view") && sessionLabel ? getShellPulse(sessionLabel).catch(() => null) : null,
    // The admin queue, counted from the same reads the Needs you page uses.
    !viewer.previewing && can(viewer.staff, "attendance:correct") && sessionLabel
      ? loadInbox(viewer.staff, sessionLabel, schoolToday()).catch(() => null)
      : null,
  ]);
  if (pulse) out.dues = pulse.overdueStudentCount;
  if (inbox) out.inbox = inbox.items.length;
  return out;
}

/** "Large text" from Settings or the teacher's More tab, applied to every screen. */
async function prefersLargeText(staffProfileId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("staff_ui_preferences")
    .select("large_text")
    .eq("staff_profile_id", staffProfileId)
    .maybeSingle<{ large_text: boolean }>();
  return data?.large_text === true;
}

/**
 * The one frame every signed-in screen sits in (PLAN A.5, docs/ui/DECISIONS.md
 * UI-8): sidebar from 900px, bottom bar below it, the search palette, toasts
 * and the overlay layer. Screens draw their own top bar inside `VxPage`.
 */
export async function VxShell({
  viewer,
  sessionLabel,
  sessionIsTest,
  children,
}: {
  viewer: Viewer;
  sessionLabel: string;
  sessionIsTest: boolean;
  children: ReactNode;
}) {
  const { staff, menu, previewing } = viewer;
  const previewPerms = previewing ? await previewPermissions(previewing) : null;
  const allowed = (p: StaffPermission) => (previewPerms ? previewPerms.has(p) : can(staff, p));

  const groups = groupsFor(menu, allowed);
  const tabs = bottomFor(menu, allowed);
  const badges = loadBadges(viewer, sessionLabel);
  const fees = can(staff, "fees:view");
  const large = await prefersLargeText(staff.id).catch(() => false);

  const roleLine = `${MENU_LABEL[menu].en}${sessionLabel ? ` · ${sessionLabel.replace("-", "–")}` : ""}`;
  const me = {
    initials: initials(staff.displayName),
    name: staff.displayName,
    sub: staff.email ?? MENU_LABEL[menu].en,
    href: can(staff, "settings:manage") ? "/settings" : "/preferences",
    color: avatarColor(staff.displayName),
  };
  const previewMenus =
    staff.role === "admin"
      ? ROLE_PREVIEW_MENUS.map((m) => ({ key: m, label: MENU_LABEL[m], icon: PREVIEW_ICON[m as keyof typeof PREVIEW_ICON] }))
      : [];

  const palette: PaletteItem[] = groups.flatMap((g) =>
    g.items.map((i) => ({ label: i.label, icon: i.icon, href: i.href, group: g.title?.en ?? "" })),
  );

  const sessionPill = fees ? (
    <span className="vx-reset">
      <Suspense fallback={<ShellSessionPillSkeleton currentLabel={sessionLabel} isTest={sessionIsTest} />}>
        <ShellSessionPill
          currentLabel={sessionLabel}
          isTest={sessionIsTest}
          sessions={getSessionSwitcherData().catch(() => ({ activeSessionLabel: sessionLabel, availableSessions: [] }))}
        />
      </Suspense>
    </span>
  ) : null;

  return (
    <SessionSwitchingProvider>
      <ToastProvider>
        <Suspense fallback={null}>
          <RouteProgress />
          {fees ? <OfficeSyncListener sessionLabel={sessionLabel} /> : null}
        </Suspense>
        <a href="#vx-main" className="vx-skip">Skip to content</a>
        <div className={`vxt vx-shell${large ? " vx-large" : ""}`}>
          <VxSidebar
            groups={groups}
            me={me}
            roleLine={roleLine}
            home={MENU_HOME[menu]}
            badges={badges}
            teacherSized={menu === "teacher"}
            previewMenus={previewMenus}
            previewing={previewing}
            sessionPill={sessionPill}
          />
          <div className="vx-content">
            <OfflineBanner />
            <SessionSwitchOverlayMount />
            {previewing ? <PreviewBanner label={MENU_LABEL[previewing].en} /> : null}
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
      </ToastProvider>
    </SessionSwitchingProvider>
  );
}
