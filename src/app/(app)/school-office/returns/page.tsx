import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { returnsBoard } from "@/modules/government-records/data/readiness";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { ReturnsBoard } from "@/vx/screens/school-office/returns";
import { G } from "@/vx/screens/school-office/return-text";
export const runtime = "nodejs";
export const metadata = { title: "Government returns" };
export default async function ReturnsPage() {
  const staff = await requirePermission("government:view", "/school-office/returns");
  const session = await resolveSessionLabel();
  const board = session ? await returnsBoard(session).catch(() => null) : null;
  return <VxPage><TopBar title={lead(G.title, staff.language)} crumb={session} mBack="/school-office" /><main><Section><ReturnsBoard sessionLabel={session ?? ""} cards={board?.cards ?? []} canManage={can(staff, "settings:manage")} unavailable={!board} sourceUnavailable={board?.sourceUnavailable ?? false} /></Section></main></VxPage>;
}
