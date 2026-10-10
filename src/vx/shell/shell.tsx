import { Suspense, type ReactNode } from "react";

import { getShellPulse } from "@/modules/dashboard/data/shell-metrics";
import { getSessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { SessionSwitchingProvider } from "@/modules/fees/platform/session-context/switching-context";
import { can, rolePermissions, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { OfficeSyncListener } from "@/ui/shell/office-sync-listener";
import { RouteProgress } from "@/ui/shell/route-progress";
import { SessionSwitchOverlayMount } from "@/ui/shell/session-switch-overlay";
import { ShellSessionPill, ShellSessionPillSkeleton } from "@/ui/shell/shell-session-pill";
import { initials } from "@/vx/format";
import { bottomFor, groupsFor, MENU_HOME, MENU_LABEL, ROLE_PREVIEW_MENUS, type DesignMenu } from "@/vx/nav";
import { avatarColor } from "@/vx/ui/primitives";
import { ToastProvider } from "@/vx/ui/overlays";
import type { Viewer } from "@/vx/view-as";

import { VxBottomBar } from "./bottom-bar";
import { SearchPalette, type PaletteItem } from "./palette";
import { PreviewBanner } from "./preview-banner";
import { VxSidebar, type Badges } from "./sidebar";

/** Which real role an admin's "See the app as" borrows permissions from. */
const PREVIEW_ROLE: Record<DesignMenu, StaffRole> = {
  admin: "admin",
  teacher: "teacher",
  accountant: "accountant",
  academic: "academic_coordinator",
  exam: "exam_coordinator",
};

const PREVIEW_ICON = { teacher: "grad", accountant: "rupee", academic: "trend", exam: "award" } as const;

async function loadBadges(viewer: Viewer, sessionLabel: string): Promise<Badges> {
  const out: Badges = {};
  if (can(viewer.staff, "fees:view") && sessionLabel) {
    const pulse = await getShellPulse(sessionLabel).catch(() => null);
    if (pulse) out.dues = pulse.overdueStudentCount;
  }
  return out;
}

/**
 * The one frame every signed-in screen sits in (PLAN A.5, docs/ui/DECISIONS.md
 * UI-8): sidebar from 900px, bottom bar below it, the search palette, toasts
 * and the overlay layer. Screens draw their own top bar inside `VxPage`.
 */
export function VxShell({
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
  const previewPerms = previewing ? new Set<StaffPermission>(rolePermissions[PREVIEW_ROLE[previewing]]) : null;
  const allowed = (p: StaffPermission) => (previewPerms ? previewPerms.has(p) : can(staff, p));

  const groups = groupsFor(menu, allowed);
  const tabs = bottomFor(menu, allowed);
  const badges = loadBadges(viewer, sessionLabel);
  const fees = can(staff, "fees:view");

  const roleLine = `${MENU_LABEL[menu].en}${sessionLabel ? ` · ${sessionLabel.replace("-", "–")}` : ""}`;
  const me = {
    initials: initials(staff.displayName),
    name: staff.displayName,
    sub: staff.email ?? MENU_LABEL[menu].en,
    href: "/settings",
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
        <div className="vxt vx-shell">
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
            <SessionSwitchOverlayMount />
            {previewing ? <PreviewBanner label={MENU_LABEL[previewing].en} /> : null}
            <main id="vx-main" className="vx-main vx-reset">
              {children}
            </main>
          </div>
          <VxBottomBar tabs={tabs} badges={badges} />
        </div>
        <SearchPalette items={palette} />
        <div id="vx-layer" className="vxt vx-layer" />
      </ToastProvider>
    </SessionSwitchingProvider>
  );
}
