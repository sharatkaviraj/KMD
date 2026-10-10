import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { PerformanceReporter } from "@/modules/performance/ui/performance-reporter";
import { can } from "@/platform/auth/permissions";
import { getAppMode } from "@/platform/env";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { VxShell } from "@/vx/shell/shell";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

/**
 * The frame every signed-in screen sits in: the redesigned shell from the
 * approved design pack (docs/design-handoff, docs/ui/DECISIONS.md UI-8).
 *
 * One nav config (`src/vx/nav.ts`) drives the sidebar, the phone bottom bar,
 * the phone Menu page and the search palette, and every item names the
 * permission that shows it. An administrator can "see the app as" another
 * role; the shell then draws that role's menu and every write refuses.
 *
 * The fee session is resolved here, as before, because the fee screens and
 * the realtime listener both need it.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const viewer = await getViewer();
  const { staff } = viewer;
  const financeEnabled = can(staff, "fees:view");
  const resolvedSession = financeEnabled
    ? await getViewSessionCookie()
        .then((cookieSession) => resolveViewSession({ cookieSession }))
        // A fee screen without a session is broken; an attendance register
        // without one is fine.
        .catch(() => null)
    : null;
  const academicSession = financeEnabled ? null : await resolveSessionLabel().catch(() => null);

  return (
    <LanguageProvider language={staff.language}>
      <VxShell
        viewer={viewer}
        sessionLabel={resolvedSession?.sessionLabel ?? academicSession ?? ""}
        sessionIsTest={resolvedSession?.isTest ?? getAppMode() === "test"}
      >
        {children}
        <PerformanceReporter />
      </VxShell>
    </LanguageProvider>
  );
}
