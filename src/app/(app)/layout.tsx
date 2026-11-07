import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getSessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { PerformanceReporter } from "@/modules/performance/ui/performance-reporter";
import { can } from "@/platform/auth/permissions";
import { canSwitchSessions, isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { readDeploymentEnvironment } from "@/platform/deployment/marker";
import { getAppMode } from "@/platform/env";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { VxShell } from "@/vx/shell/shell";
import { getViewer, PREVIEW_ROLE, previewPermissions, rolePreviewOf } from "@/vx/view-as";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { RosterStatus } from "@/platform/fees-bridge/roster-status";

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
 * The session is resolved here for every screen, fee or native (Phase 3, plan
 * §3.3): `resolveViewSession` for a fee reader, `resolveSessionLabel` for
 * everyone else — both follow the session pill's cookie for a viewer allowed
 * to switch, and both keep a real member of staff out of TEST-2026-27 and a
 * test account inside it. The pill itself is drawn for fee readers, the two
 * coordinators, the admin and test accounts; a teacher stays on the session
 * the school is in. An admin seeing the app as another role sees that role's
 * pill and that role's sessions.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const viewer = await getViewer();
  const { staff } = viewer;
  // A role preview stands in for a role; seeing One as a person is that
  // person, with their own role, sessions and pill (D-544).
  const previewing = rolePreviewOf(viewer);
  const financeEnabled = can(staff, "fees:view");
  /*
   * Nothing below waits on anything it does not need. The shell (and with it
   * every screen's loading skeleton) cannot reach the phone until this layout
   * resolves, so each read here that waited for the one before it was a full
   * round trip added to every first open. The session, the previewed role's
   * permissions and the production marker are independent reads: they start
   * together. The marker is cheap (cached per instance, fails closed) and is
   * only *used* when the pill is shown, exactly as before.
   */
  const previewRole = previewing ? PREVIEW_ROLE[previewing] : null;
  const [resolvedSession, academicSession, previewFeeReader, deploymentEnvironment] = await Promise.all([
    financeEnabled
      ? getViewSessionCookie()
          .then((cookieSession) => resolveViewSession({ cookieSession }))
          // A fee screen without a session is broken; an attendance register
          // without one is fine.
          .catch(() => null)
      : null,
    financeEnabled ? null : resolveSessionLabel().catch(() => null),
    previewing ? previewPermissions(previewing).then((permissions) => permissions.has("fees:view")) : null,
    isConfinedDeployment() ? null : readDeploymentEnvironment(),
  ]);
  const sessionLabel = resolvedSession?.sessionLabel ?? academicSession ?? "";
  const showBridgeStatus = usesCanonicalFees(staff, sessionLabel);

  const pillViewer = {
    role: previewRole ?? staff.role,
    isTestAccount: staff.isTestAccount === true,
    feeReader: previewFeeReader ?? financeEnabled,
  };
  const showPill = Boolean(sessionLabel) && canSwitchSessions(pillViewer);
  // "Live ·" only on the production database, outside a confined deployment.
  const showLive = showPill && !isConfinedDeployment() && deploymentEnvironment === "production";

  return (
    <LanguageProvider language={staff.language}>
      <VxShell
        viewer={viewer}
        sessionLabel={sessionLabel}
        rosterStatus={showBridgeStatus ? <Suspense fallback={<span className="vx-roster-placeholder" aria-hidden="true" />}><RosterStatus language={staff.language} canRefresh={staff.role === "admin" && !previewing} /></Suspense> : null}
        sessionIsTest={resolvedSession?.isTest ?? (isTestSessionLabel(academicSession) || getAppMode() === "test")}
        sessionPill={
          showPill
            ? {
                showLive,
                // Not awaited: resolved inside the pill's Suspense boundary.
                sessions: getSessionSwitcherData(pillViewer).catch(() => ({
                  activeSessionLabel: sessionLabel,
                  availableSessions: [],
                })),
              }
            : null
        }
      >
        {children}
        <PerformanceReporter />
      </VxShell>
    </LanguageProvider>
  );
}
import { Suspense } from "react";
