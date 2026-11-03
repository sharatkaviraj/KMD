import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { copilotMarks, isCopilotBatch } from "@/modules/government-records/data/copilot";
import { returnBatchForViewer } from "@/modules/government-records/data/repo";
import { copilotSheet } from "@/modules/government-records/domain/copilot";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";
import { PortalCopilot } from "@/vx/screens/school-office/copilot";
import { C } from "@/vx/screens/school-office/copilot-text";
import { PORTAL_LABELS } from "@/vx/screens/school-office/return-text";
export const runtime = "nodejs";
export const metadata = { title: "Manual entry assistant" };

/** Only a prepared manual reference sheet has rows a person types into a portal. */
export default async function ReturnCopilotPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("government:view", "/school-office/returns");
  const { previewing } = await getViewer();
  const batch = await returnBatchForViewer((await params).id);
  if (!batch || batch.direction !== "export" || batch.adapter.mode !== "manual_reference" || !batch.file_path) notFound();
  const marks = await copilotMarks(batch.id);
  const sheet = copilotSheet(batch.payload.rows ?? [], batch.adapter);
  const title = `${lead(PORTAL_LABELS[batch.portal] ?? { en: batch.portal }, staff.language)} · ${batch.module} · ${batch.session_label}`;
  return <VxPage><TopBar title={lead(C.title, staff.language)} crumb={batch.session_label} mBack={`/school-office/returns/${batch.id}`} /><main><Section>
    <PortalCopilot batchId={batch.id} title={title} headers={sheet.headers} rows={sheet.rows} marks={marks} canMark={!previewing && can(staff, "government:export") && isCopilotBatch(batch)} />
  </Section></main></VxPage>;
}
