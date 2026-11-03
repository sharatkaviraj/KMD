import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listCertificates } from "@/modules/certificates/data/repo";
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
  const [params, sessionLabel] = await Promise.all([searchParams, resolveSessionLabel()]);
  const one = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const studentId = /^[a-f0-9-]{36}$/i.test(one("student")) ? one("student") : undefined;
  let data: Awaited<ReturnType<typeof listCertificates>> = { rows: [], count: 0, page: 1 }; let unavailable = false;
  if (sessionLabel) try { data = await listCertificates(sessionLabel, { query: one("q"), status: one("status"), studentId, page: Number(one("page")) || 1 }); } catch { unavailable = true; }
  return <VxPage><TopBar title={lead(O.title, staff.language)} crumb={sessionLabel} /><main><Section><BoardOfficeLinks />{sessionLabel ? <CertificateRegister {...data} sessionLabel={sessionLabel} query={one("q")} status={one("status")} studentId={studentId} canManage={can(staff, "certificates:manage")} canGovernment={can(staff, "government:view")} unavailable={unavailable} /> : <EmptyState icon="calendar" title={lead(O.source, staff.language)} />}</Section></main></VxPage>;
}
