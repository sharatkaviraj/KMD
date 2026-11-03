import { requirePermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { returnWorkspace } from "@/modules/government-records/data/repo";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { ReturnFormatForm } from "@/vx/screens/school-office/return-format";
import { G } from "@/vx/screens/school-office/return-text";
export const runtime = "nodejs";
export const metadata = { title: "Verified government format" };
export default async function ReturnFormatPage() {
  const staff = await requirePermission("settings:manage", "/school-office/returns/formats");
  const session = await resolveSessionLabel(), data = session ? await returnWorkspace(session) : null;
  return <VxPage><TopBar title={lead(G.adapter, staff.language)} mBack="/school-office/returns" /><main><Section>{session && data ? <ReturnFormatForm sessionLabel={session} adapters={data.adapters} /> : <EmptyState icon="calendar" title={lead(G.checkFailed, staff.language)} />}</Section></main></VxPage>;
}
