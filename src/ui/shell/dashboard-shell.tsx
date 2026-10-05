import { ReactNode, Suspense } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";

import type { MobileMoreGroup } from "@/platform/config/mobile-navigation";
import { type StaffRole } from "@/modules/fees/platform/roles";
import { SchoolBrand } from "@/ui/branding/school-brand";
import { OfficeSyncListener } from "@/ui/shell/office-sync-listener";
import { ShellDayCard, ShellDayCardSkeleton } from "@/ui/shell/shell-day-card";
import {
  ShellSessionPill,
  ShellSessionPillSkeleton,
} from "@/ui/shell/shell-session-pill";
import { SessionSwitchOverlayMount } from "@/ui/shell/session-switch-overlay";
import { getDefaultProtectedHref } from "@/modules/fees/config/navigation";
import { getShellPulse } from "@/modules/dashboard/data/shell-metrics";
import { getFeePolicyForSession } from "@/modules/fees/domain/queries";
import { getSessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { SessionSwitchingProvider } from "@/modules/fees/platform/session-context/switching-context";

import { isLocaleSwitcherEnabled } from "@/platform/env";

import { AppTopBar } from "./app-topbar";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileBottomNav, type MobileNavItem } from "./mobile-bottom-nav";
import { MobileTakeoverBar } from "./mobile-takeover-bar";
import { RouteProgress } from "./route-progress";
import { ScrollRestoringMain } from "./scroll-restoring-main";
import { SidebarNav, type SidebarNavGroup } from "./sidebar-nav";

/**
 * "Ledger Calm 2.0" workspace shell.
 *
 * - Ink sidebar (232px, bg --nav) with grouped navigation: the four daily
 *   screens on top, records below; live count pills for Payment Desk
 *   (receipts today) and Defaulters (overdue students).
 * - Sidebar footer is a "Day so far" card: today's collected total in the
 *   display serif + receipt count, so the desk clerk always sees the day's
 *   money without leaving the current screen.
 */

type DashboardShellProps = {
  children: ReactNode;
  staffEmail: string;
  staffRole: StaffRole;
  /**
   * The sidebar, resolved by the caller.
   *
   * The fee app derived this from its role inside the shell. This app has
   * two navigation maps and a reader whose language decides the labels, so
   * the layout resolves both and hands the answer down — see
   * `src/app/(app)/layout.tsx`.
   */
  sidebarGroups?: readonly SidebarNavGroup[];
  /** The phone bar's four tabs, likewise resolved. */
  mobileItems?: readonly MobileNavItem[];
  mobileMoreGroups?: readonly MobileMoreGroup[];
  staffRoleLabel?: string;
  /** Native permission boundary, before any optional fee chrome is read. */
  showFeeMetrics?: boolean;
  skipToContentLabel?: string;
  /** Where the school mark goes. This role's Home, not everybody's. */
  homeHref?: string;
  viewSessionLabel: string;
  viewSessionIsTest: boolean;
};

export function DashboardShell({
  children,
  staffEmail,
  staffRole,
  sidebarGroups,
  mobileItems,
  mobileMoreGroups,
  staffRoleLabel,
  showFeeMetrics = true,
  skipToContentLabel,
  homeHref: homeHrefProp,
  viewSessionLabel,
  viewSessionIsTest,
}: DashboardShellProps) {
  // Started, not awaited. This function used to `await Promise.all([...])` on
  // these three, which meant no chrome was emitted until all three came back —
  // and because the layout was blocked, the child route's `loading.tsx` could
  // not paint either. Every carefully shaped skeleton in this app only appeared
  // *after* the slow part was over. They now resolve inside their own Suspense
  // boundaries below, so the frame and the skeleton go out first.
  //
  // Each `.catch()` is doing two jobs. An unawaited promise that rejects is an
  // unhandled rejection, and separately: a failed shell read used to take down
  // the whole workspace. A missing "Day so far" figure is not a reason nobody
  // can reach the Payment Desk.
  const pulsePromise = showFeeMetrics ? getShellPulse(viewSessionLabel).catch(() => null) : Promise.resolve(null);
  const receiptPrefixPromise = showFeeMetrics ? getFeePolicyForSession(viewSessionLabel)
    .then((policy) => policy.receiptPrefix)
    .catch(() => null) : Promise.resolve(null);
  const sessionSwitcherPromise = showFeeMetrics ? getSessionSwitcherData().catch(() => ({
    activeSessionLabel: viewSessionLabel,
    availableSessions: [],
  })) : Promise.resolve({ activeSessionLabel: viewSessionLabel, availableSessions: [] });
  const navCountsPromise = pulsePromise.then((pulse) => ({
    ...(pulse ? { "/fees/payments": pulse.todayReceiptCount, "/fees/defaulters": pulse.overdueStudentCount } : {}),
  }));
  // The phone bar gets only the follow-up count, same as before. A badge on
  // Collect would read as "3 payments waiting", which is not a thing. Derived
  // from the same promise, so it costs no second read.
  const mobileNavCountsPromise = pulsePromise.then((pulse) => ({
    ...(pulse ? { "/fees/defaulters": pulse.overdueStudentCount } : {}),
  }));

  const homeHref = homeHrefProp ?? getDefaultProtectedHref(staffRole);
  const localeSwitcher = isLocaleSwitcherEnabled() ? <LocaleSwitcher /> : null;
  // School time, not server time — the greeting must match the clock on the
  // office wall, and it must be right on first paint (no post-hydration swap).
  const schoolHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );

  return (
    <SessionSwitchingProvider>
      <div className="min-h-svh w-full overflow-x-clip bg-background text-foreground lg:h-screen lg:overflow-hidden">
      {skipToContentLabel ? (
        <a href="#main-content" className="focus-ring sr-only fixed left-4 top-4 z-[70] rounded-xl bg-card text-foreground shadow-lg focus:not-sr-only focus:min-h-[44px] focus:px-4 focus:py-3">
          {skipToContentLabel}
        </a>
      ) : null}
      <Suspense fallback={null}>
        <RouteProgress />
        {showFeeMetrics ? <OfficeSyncListener sessionLabel={viewSessionLabel} /> : null}
      </Suspense>

      {/* Sidebar (desktop) — ink surface */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-[232px] border-r border-nav-border bg-nav text-nav-foreground print:hidden lg:flex lg:flex-col"
        aria-label="Workspace sidebar"
      >
        <Link
          href={homeHref}
          className="flex items-center gap-3 border-b border-nav-border px-4 py-4 transition-colors hover:bg-nav-hover focus-ring-ink"
        >
          <SchoolBrand variant="sidebar-ink" preload />
        </Link>

        {/* no-scrollbar: a light OS scrollbar track on the ink panel reads as
            a rendering fault once the nav list overflows a short viewport. */}
        <div className="no-scrollbar flex-1 overflow-y-auto px-2 py-3">
          <SidebarNav
            staffRole={staffRole}
            groups={sidebarGroups}
            tone="ink"
            countsPromise={navCountsPromise}
          />
        </div>

        <footer className="border-t border-nav-border px-3 py-3">
          <p className="flex items-center gap-2 px-1 text-xs leading-5 text-nav-muted">
            <CalendarDays className="size-3.5 text-accent" aria-hidden="true" />
            <span className="font-medium text-nav-foreground">{viewSessionLabel}</span>
            {viewSessionIsTest ? (
              <span className="ml-auto rounded-full bg-warning-soft px-1.5 text-[10px] font-semibold uppercase text-warning-soft-foreground">
                TEST
              </span>
            ) : null}
          </p>
          {/* Day so far */}
          {showFeeMetrics ? <Suspense fallback={<ShellDayCardSkeleton />}>
            <ShellDayCard pulse={pulsePromise} receiptPrefix={receiptPrefixPromise} />
          </Suspense> : null}
        </footer>
      </aside>

      <div className="relative min-w-0 lg:ml-[232px] lg:h-screen lg:overflow-y-auto">
        <SessionSwitchOverlayMount />
        {/* No phone app bar (mobile v2). The design gives every screen its
            own header and keeps only the tab bar as shared chrome. What this
            bar used to carry now lives where a phone user looks for it:
            greeting + session pill + avatar on Home, and language, appearance,
            password and sign-out in Settings. */}
        <AppTopBar
          staffEmail={staffEmail}
          staffRole={staffRole}
          schoolHour={schoolHour}
          sidebarGroups={sidebarGroups}
          staffRoleLabel={staffRoleLabel}
          sessionPill={
            showFeeMetrics ? <Suspense
              fallback={
                <ShellSessionPillSkeleton
                  currentLabel={viewSessionLabel}
                  isTest={viewSessionIsTest}
                />
              }
            >
              <ShellSessionPill
                currentLabel={viewSessionLabel}
                isTest={viewSessionIsTest}
                sessions={sessionSwitcherPromise}
              />
            </Suspense> : <span className="text-sm text-muted-foreground">{viewSessionLabel}</span>
          }
          localeSwitcher={localeSwitcher}
        />
        <ScrollRestoringMain
          /* The back bar lives INSIDE the scroll region so it can pin with
             sticky instead of position:fixed, and so main can be exactly
             100dvh — a bar above main would make the document taller than the
             viewport and reintroduce page scrolling. */
          mobileBar={<MobileTakeoverBar />}
          /* Full-bleed on phones: main IS the scroll region (mobile-app-main),
             so it owns the viewport height and its own bottom-nav clearance.
             Document padding here would double the inset and push content
             under the tab bar. */
          className="mx-auto max-w-7xl md:px-6 md:py-5 lg:px-8 lg:py-7 2xl:max-w-[88rem] md:pb-6 lg:pb-8 print:max-w-none print:px-0 print:py-0"
        >
          {/* Phone padding lives inside the scroll region, not on main —
              main is the 100dvh viewport and must not be inset. The fade
              plays once per hard load: this layout persists across
              navigations. Do NOT wrap children in React's ViewTransition
              here: on a streamed navigation React holds the transition's
              update callback until the route's data lands, the browser
              freezes rendering while it waits, Chrome gives up after four
              seconds, and the navigation then falls back to a full page
              load. It made every tab switch feel like a reload. */}
          <div className="anim-fade-in px-4 py-4 md:px-0 md:py-0">{children}</div>
        </ScrollRestoringMain>
        {/* Phone bar badges: only the follow-up count. A badge on Collect
            would read as "3 payments waiting", which is not a thing. */}
        <MobileBottomNav
          staffRole={staffRole}
          items={mobileItems}
          moreGroups={mobileMoreGroups}
          staffRoleLabel={staffRoleLabel}
          staffEmail={staffEmail}
          countsPromise={mobileNavCountsPromise}
        />
      </div>
      </div>
    </SessionSwitchingProvider>
  );
}
