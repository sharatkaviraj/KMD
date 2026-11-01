import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { returnWorkspace, schoolOfficeRoster } from "@/modules/government-records/data/repo";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { GovernmentReturns } from "@/vx/screens/school-office/returns";
import { G } from "@/vx/screens/school-office/return-text";
export const runtime = "nodejs";
export const metadata = { title: "Government returns" };
export default async function ReturnsPage() {
  const staff = await requirePermission("government:view", "/school-office/returns");
  const session = await resolveSessionLabel();
  const [workspace, roster] = session ? await Promise.all([returnWorkspace(session).catch(() => null), schoolOfficeRoster(session).catch(() => null)]) : [null, null];
  const classes = [...new Map((roster ?? []).map((row) => [row.classId, { id: row.classId, label: row.classLabel }])).values()];
  return <VxPage><TopBar title={lead(G.title, staff.language)} crumb={session} mBack="/school-office" /><main><Section><GovernmentReturns sessionLabel={session ?? ""} batches={workspace?.batches ?? []} adapters={workspace?.adapters ?? []} classes={classes} canExport={can(staff, "government:export")} canManage={can(staff, "settings:manage")} unavailable={!workspace} sourceUnavailable={!roster} /></Section></main></VxPage>;
}
