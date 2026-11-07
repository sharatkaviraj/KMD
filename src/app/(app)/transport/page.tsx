import { after } from "next/server";

import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { approvedStudentPhotos } from "@/modules/collection/data/approved-photos";
import type { Rider } from "@/modules/transport/domain/board";
import { readFleet, type Fleet } from "@/modules/transport/data/fleet";
import { readRiders } from "@/modules/transport/data/riders";
import { readRoutes } from "@/modules/transport/data/routes";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { lead } from "@/vx/text";
import { TransportScreen, type TransportTab } from "@/vx/screens/transport/transport-screen";
import { W } from "@/vx/screens/transport/words";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";

export const runtime = "nodejs";

export const metadata = { title: "Transport" };

type SP = Record<string, string | string[] | undefined>;

const TABS: readonly TransportTab[] = ["routes", "times", "drivers"];

/**
 * Transport (owner, 7 Nov 2026, D-550): which children ride each route, the
 * bus runs with their times and drivers, and the drivers with their buses.
 *
 * Routes and the children on them come from Fees (the real year through One's
 * nightly roster copy and the route names Fees sends; a TEST session from the
 * local tables). The buses and drivers are One's own. `transport:view` opens
 * the screen; `transport:manage` adds the buttons that change it.
 */
export default async function TransportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("transport:view", "/transport");
  const sp = await searchParams;
  const asked = typeof sp.tab === "string" ? sp.tab : "";
  const tab: TransportTab = (TABS as readonly string[]).includes(asked) ? (asked as TransportTab) : "routes";
  const session = await resolveSessionLabel();
  const language = staff.language;

  if (!session) {
    return (
      <VxPage label={lead(W.title, language)}>
        <TopBar title={lead(W.title, language)} mBack="/menu" />
        <Section>
          <EmptyState icon="bus" title={lead(W.noSession, language)} body={lead(W.noSessionBody, language)} />
        </Section>
      </VxPage>
    );
  }

  const canonical = usesCanonicalFees(staff, session);
  const [routes, riderRows, fleet, classes] = await Promise.all([
    readRoutes(canonical, (task) => after(task)).catch(() => ({ routes: [], source: "none" as const, refreshedAt: null })),
    readRiders(session).catch(() => null),
    readFleet(session).catch((): Fleet | null => null),
    classLabelMap(session).catch(() => new Map<string, string>()),
  ]);

  if (!riderRows || !fleet) {
    return (
      <VxPage label={lead(W.title, language)}>
        <TopBar title={lead(W.title, language)} mBack="/menu" />
        <Section>
          <EmptyState icon="alert" title={lead(W.couldNotLoad, language)} />
        </Section>
      </VxPage>
    );
  }

  const order = new Map([...classes.keys()].map((id, index) => [id, index]));
  const seesChildren = can(staff, "students:view");
  const photos = seesChildren
    ? await approvedStudentPhotos(riderRows.map((r) => r.id)).catch(() => new Map<string, string>())
    : new Map<string, string>();
  const riders: Rider[] = riderRows.map((r) => ({
    ...r,
    classLabel: classes.get(r.classId) ?? "—",
    classOrder: order.get(r.classId) ?? Number.MAX_SAFE_INTEGER,
    photo: photos.get(r.id) ?? null,
  }));

  return (
    <TransportScreen
      sessionLabel={session}
      test={isTestSessionLabel(session)}
      canManage={can(staff, "transport:manage")}
      canRefreshNames={canonical && can(staff, "transport:manage")}
      canOpenChildren={seesChildren}
      fleetReady={fleet.ready}
      routeSource={routes.source}
      routes={routes.routes}
      riders={riders}
      drivers={fleet.ready ? fleet.drivers : []}
      trips={fleet.ready ? fleet.trips : []}
      initialTab={tab}
    />
  );
}
