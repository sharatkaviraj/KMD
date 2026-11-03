import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { returnBatchForViewer, returnEvents } from "@/modules/government-records/data/repo";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";
import { ReturnBatchDetail } from "@/vx/screens/school-office/return-detail";
import { G } from "@/vx/screens/school-office/return-text";
export const runtime = "nodejs";
export const metadata = { title: "Government return batch" };
export default async function ReturnBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("government:view", "/school-office/returns");
  const { previewing } = await getViewer();
  const batch = await returnBatchForViewer((await params).id); if (!batch) notFound();
  const events = await returnEvents(batch.id);
  return <VxPage><TopBar title={lead(G.title, staff.language)} crumb={batch.session_label} mBack="/school-office/returns" /><main><Section><ReturnBatchDetail batch={batch} events={events} canExport={!previewing && can(staff, "government:export")} canImport={!previewing && can(staff, "government:import")} /></Section></main></VxPage>;
}
