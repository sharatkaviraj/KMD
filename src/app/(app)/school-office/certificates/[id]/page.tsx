import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { certificateEvents, certificateForViewer } from "@/modules/certificates/data/repo";
import { getViewer } from "@/vx/view-as";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { CertificateDetail } from "@/vx/screens/school-office/certificate-detail";
import { KIND_LABELS } from "@/vx/screens/school-office/text";
export const runtime = "nodejs";
export const metadata = { title: "Certificate" };
export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("certificates:view", "/school-office");
  const { previewing } = await getViewer();
  const issue = await certificateForViewer((await params).id);
  if (!issue) notFound();
  const events = await certificateEvents(issue.id);
  return <VxPage><TopBar title={lead(KIND_LABELS[issue.kind ?? "study"], staff.language)} crumb={issue.serial} mBack="/school-office" /><main><Section><CertificateDetail issue={issue} events={events} canIssue={!previewing && can(staff, "certificates:issue")} canManage={!previewing && can(staff, "certificates:manage")} /></Section></main></VxPage>;
}
