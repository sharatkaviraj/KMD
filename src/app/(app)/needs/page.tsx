import { redirect } from "next/navigation";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { needsView } from "@/modules/needs-you/data/board";
import { accountantSource, examSource, NO_JOBS, teacherSource, type NeedsSource } from "@/modules/needs-you/data/sources";
import type { NeedsRole } from "@/modules/needs-you/domain/types";
import { NW } from "@/modules/needs-you/domain/words";
import { NeedsBoard } from "@/modules/needs-you/ui/board";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolNow } from "@/platform/auth/qa-clock";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { loadHome } from "@/vx/screens/teach/data";
import { lead, p } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

export const metadata = { title: "Needs you" };

const ROLE: Record<string, NeedsRole> = { teacher: "teacher", accountant: "accountant", exam: "exam" };

/**
 * Needs you (D-630): everything waiting on this person, in order, with what
 * they finished today and their own to-dos. A teacher's, the fee office's
 * and the exam office's lists are read from the screens that own each job;
 * whoever decides the school's queue (the admin, the coordinators) has that
 * queue as their Needs you, at /inbox.
 */
export default async function NeedsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("dashboard:view", "/needs");
  const viewer = await getViewer();
  if (can(staff, "attendance:correct") && !(viewer.menu in ROLE)) redirect("/inbox");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) {
    return (
      <VxPage label={lead(NW.title, staff.language)}>
        <TopBar title={lead(NW.title, staff.language)} />
        <main>
          <Section>
            <EmptyState icon="calendar" title={lead(p("No session is set up yet", "अभी कोई सत्र नहीं है"), staff.language)} />
          </Section>
        </main>
      </VxPage>
    );
  }

  const now = await schoolNow(staff);
  const role: NeedsRole = ROLE[viewer.menu] ?? "admin";
  let source: NeedsSource = NO_JOBS;
  if (role === "teacher" && can(staff, "attendance:view")) {
    const home = await loadHome(staff);
    if (home.periods) source = await teacherSource(staff, home);
  } else if (role === "accountant") {
    const sp = await searchParams;
    const cookie = await getViewSessionCookie();
    const canonical = usesCanonicalFees(staff, typeof sp.session === "string" ? sp.session : cookie);
    const feeSessionLabel = canonical ? sessionLabel : (await resolveViewSession({ searchParamSession: sp.session, cookieSession: cookie })).sessionLabel;
    source = await accountantSource(staff, { sessionLabel, feeSessionLabel, canonical, now });
  } else if (role === "exam") {
    source = await examSource(staff, now);
  }
  const view = await needsView(staff, { role, source, sessionLabel, now });

  return (
    <VxPage label={lead(NW.title, staff.language)}>
      <NeedsBoard view={view} />
    </VxPage>
  );
}
