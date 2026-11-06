import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { deskCounts, listCertificates, signingTray, type DeskCounts } from "@/modules/certificates/data/repo";
import type { CertificateIssue } from "@/modules/certificates/domain/certificate";
import { schoolToday } from "@/vx/format";
import { getViewer } from "@/vx/view-as";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { CertificateRegister } from "@/vx/screens/school-office/certificates";
import { O } from "@/vx/screens/school-office/text";
import { BoardOfficeLinks } from "@/vx/screens/board-office/links";

export const runtime = "nodejs";
export const metadata = { title: "School Office" };

export default async function SchoolOfficePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("certificates:view", "/school-office");
  const [params, sessionLabel, { previewing }] = await Promise.all([searchParams, resolveSessionLabel(), getViewer()]);
  const one = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const studentId = /^[a-f0-9-]{36}$/i.test(one("student")) ? one("student") : undefined;
  const canIssue = can(staff, "certificates:issue") && !previewing;
  let data: Awaited<ReturnType<typeof listCertificates>> = { rows: [], count: 0, page: 1 }; let unavailable = false;
  let counts: DeskCounts | null = null; let tray: CertificateIssue[] = [];
  if (sessionLabel) {
    const filtered = Boolean(one("q") || one("status") || one("kind") || studentId);
    const [list, desk, pile] = await Promise.allSettled([
      listCertificates(sessionLabel, { query: one("q"), status: one("status"), kind: one("kind"), studentId, page: Number(one("page")) || 1 }),
      filtered ? Promise.resolve(null) : deskCounts(sessionLabel, schoolToday()),
      canIssue && !filtered ? signingTray(sessionLabel) : Promise.resolve([]),
    ]);
    if (list.status === "fulfilled") data = list.value; else unavailable = true;
    if (desk.status === "fulfilled") counts = desk.value;
    if (pile.status === "fulfilled") tray = pile.value;
  }
  return <VxPage><TopBar title={lead(O.title, staff.language)} crumb={sessionLabel} /><main><Section>{sessionLabel ? <CertificateRegister {...data} sessionLabel={sessionLabel} query={one("q")} status={one("status")} kind={one("kind")} studentId={studentId} canManage={can(staff, "certificates:manage")} canGovernment={can(staff, "government:view")} canIssue={canIssue} unavailable={unavailable} counts={counts} tray={tray} /> : <EmptyState icon="calendar" title={lead(O.source, staff.language)} />}{/* Below the register, not above it (UX review 6 Nov 2026). */}<BoardOfficeLinks /></Section></main></VxPage>;
}
