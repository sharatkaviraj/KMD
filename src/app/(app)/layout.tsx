import { requireStaff } from "@/platform/auth/current-staff";
import { feeRoleFor } from "@/platform/auth/fee-roles";
import { getAppMode } from "@/platform/env";
import { primary } from "@/platform/i18n/language";
import { LanguageProvider } from "@/platform/i18n/use-language";
import {
  homeFor,
  navigationFor,
  sidebarFor,
} from "@/platform/config/navigation";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { CommandHost } from "@/ui/command/command-host";
import { DashboardShell } from "@/ui/shell/dashboard-shell";
import { KeyboardOffsetProvider } from "@/ui/system/keyboard-offset-provider";

export const runtime = "nodejs";

/**
 * The frame every signed-in screen sits in.
 *
 * This is School Fees' `DashboardShell` — the flush-left ink sidebar, the top
 * bar, the phone tab bar, the route-progress hairline, the realtime listener —
 * driven by **this** app's navigation map. One shell, one design language, and
 * a teacher's register and an accountant's Payment Desk drawn by the same
 * components.
 *
 * It replaced `AppShell`, which was this app's own centred `max-w-7xl` frame.
 * That was D0's deliberate deviation #4 ("the atlas draws a sidebar flush to
 * the viewport edge; this widens the existing centred container instead"), and
 * it is deliberately reversed: the two apps are becoming one, and the chrome
 * was the most visible thing still saying otherwise.
 *
 * **The navigation is resolved here rather than inside the shell.** The fee app
 * derived its sidebar from a role, because it had one map. This app has two —
 * its own, whose labels are Hindi/English pairs that only a reader's language
 * can resolve, and the fee app's — and the sidebar shows both. So the layout
 * does the resolving and hands the shell an answer.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [staff, resolvedSession] = await Promise.all([
    requireStaff(),
    getViewSessionCookie()
      .then((cookieSession) => resolveViewSession({ cookieSession }))
      // A fee screen without a session is broken; an attendance register
      // without one is fine. Falling back keeps the second working when the
      // first cannot, rather than taking the whole app down with it.
      .catch(() => null),
  ]);

  const language = staff.language;

  /*
   * Labels resolved to the reader's language. **Icons are not sent.**
   *
   * A `LucideIcon` is a forwardRef object, and neither it nor an element
   * built from it survives the trip to a Client Component in a production
   * build — `/dashboard` rendered its error boundary in prod and was fine in
   * dev, twice, before this was the answer. The nav bars import
   * `navIconFor()` and look the picture up themselves.
   *
   * `primary()` rather than `flat()`: the sidebar is narrow and a bilingual
   * pair wraps to two lines on every item, which is a different product from
   * the one this is meant to look like. A `both` reader gets the Hindi lead
   * here and the pair everywhere it fits — headings, table columns, forms.
   */
  const sidebarGroups = sidebarFor(staff.role).map((group) => ({
    key: group.title.en,
    label: primary(group.title, language),
    items: group.items.map((item) => ({
      href: item.href,
      label: primary(item.label, language),
    })),
  }));

  const mobileItems = navigationFor(staff.role).map((item) => ({
    href: item.href,
    label: primary(item.label, language),
  }));

  /*
   * The command palette's index. Icons are stripped on purpose.
   *
   * `CommandHost` is a Client Component and a `LucideIcon` is a component
   * reference, which cannot cross that boundary — the fee app's own note
   * records that leaving one in made the whole layout render its error
   * fallback in production, and only in production.
   */
  const commandNavigation = sidebarGroups.flatMap((group) =>
    group.items.map((item) => ({
      href: item.href,
      label: item.label,
      description: group.label,
    })),
  );

  return (
    <LanguageProvider language={language}>
      <DashboardShell
        staffEmail={staff.email ?? staff.displayName}
        staffRole={feeRoleFor(staff.role)}
        sidebarGroups={sidebarGroups}
        mobileItems={mobileItems}
        homeHref={homeFor(staff.role)}
        viewSessionLabel={resolvedSession?.sessionLabel ?? ""}
        viewSessionIsTest={resolvedSession?.isTest ?? getAppMode() === "test"}
      >
        <KeyboardOffsetProvider />
        {children}
        <CommandHost
          navigation={commandNavigation}
          canViewStudents={staff.role !== "teacher"}
          canViewReceipts={
            sidebarGroups.some((group) =>
              group.items.some((item) => item.href.startsWith("/fees/")),
            )
          }
        />
      </DashboardShell>
    </LanguageProvider>
  );
}
