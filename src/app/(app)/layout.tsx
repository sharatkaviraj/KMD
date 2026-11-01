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
import { getViewer, PREVIEW_ROLE, previewPermissions } from "@/vx/view-as";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { readFeesBridgeHealth } from "@/platform/fees-bridge/state";
import { ms } from "@/messages/setup";
import { flat } from "@/platform/i18n/language";

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
  const { staff, previewing } = viewer;
  const financeEnabled = can(staff, "fees:view");
  const resolvedSession = financeEnabled
    ? await getViewSessionCookie()
        .then((cookieSession) => resolveViewSession({ cookieSession }))
        // A fee screen without a session is broken; an attendance register
        // without one is fine.
        .catch(() => null)
    : null;
  const academicSession = financeEnabled ? null : await resolveSessionLabel().catch(() => null);
  const sessionLabel = resolvedSession?.sessionLabel ?? academicSession ?? "";
  const bridgeHealth=usesCanonicalFees(staff,sessionLabel) ? await readFeesBridgeHealth().catch(()=>({state:null,status:"error" as const})) : null;

  const previewRole = previewing ? PREVIEW_ROLE[previewing] : null;
  const pillViewer = {
    role: previewRole ?? staff.role,
    isTestAccount: staff.isTestAccount === true,
    feeReader: previewing ? (await previewPermissions(previewing)).has("fees:view") : financeEnabled,
  };
  const showPill = Boolean(sessionLabel) && canSwitchSessions(pillViewer);
  // "Live ·" only on the production database, outside a confined deployment.
  const showLive = showPill && !isConfinedDeployment() && (await readDeploymentEnvironment()) === "production";

  return (
    <LanguageProvider language={staff.language}>
      <VxShell
        viewer={viewer}
        sessionLabel={sessionLabel}
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
        {bridgeHealth && <div role="status" className={`mx-4 mt-3 rounded-lg px-3 py-2 text-xs ${bridgeHealth.status==="ready"?"bg-emerald-50 text-emerald-900":"bg-amber-50 text-amber-950"}`}>
          {flat(bridgeHealth.status==="ready"?ms.bridgeRosterReady:bridgeHealth.status==="stale"?ms.bridgeRosterStale:bridgeHealth.status==="error"?ms.bridgeRosterError:ms.bridgeRosterPending,staff.language)}
          {bridgeHealth.state?.last_checked_at && Number.isFinite(Date.parse(bridgeHealth.state.last_checked_at)) && <span className="ml-2">{new Intl.DateTimeFormat(staff.language==="hi"?"hi-IN":"en-IN",{timeZone:"Asia/Kolkata",dateStyle:"short",timeStyle:"short"}).format(new Date(bridgeHealth.state.last_checked_at))}</span>}
        </div>}
        {children}
        <PerformanceReporter />
      </VxShell>
    </LanguageProvider>
  );
}
