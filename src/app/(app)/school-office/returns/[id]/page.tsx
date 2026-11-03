import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { returnBatchForViewer, returnEvents } from "@/modules/government-records/data/repo";
import { copilotMarks, isCopilotBatch } from "@/modules/government-records/data/copilot";
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
  const manual = batch.direction === "export" && batch.adapter.mode === "manual_reference" && !!batch.file_path;
  const [events, marks] = await Promise.all([returnEvents(batch.id), manual ? copilotMarks(batch.id).catch(() => null) : Promise.resolve(null)]);
  const rows = batch.payload.rows ?? [];
  const names = new Map(rows.map((row) => [row.studentId, row.studentName]));
  const copilot = marks ? {
    total: rows.length,
    entered: Object.values(marks).filter((mark) => mark.state === "entered").length,
    mismatches: Object.entries(marks).filter(([, mark]) => mark.state === "mismatch").map(([key, mark]) => ({ key, name: names.get(key) ?? "", note: mark.note ?? "" })),
    open: isCopilotBatch(batch),
  } : null;
  return <VxPage><TopBar title={lead(G.title, staff.language)} crumb={batch.session_label} mBack="/school-office/returns" /><main><Section><ReturnBatchDetail batch={batch} events={events} copilot={copilot} canExport={!previewing && can(staff, "government:export")} canImport={!previewing && can(staff, "government:import")} /></Section></main></VxPage>;
}
