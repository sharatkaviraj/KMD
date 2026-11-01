import { requirePermission } from "@/platform/auth/current-staff";
import { currentCertificateTemplate } from "@/modules/certificates/data/repo";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { CertificateTemplateForm } from "@/vx/screens/school-office/template";
import { O } from "@/vx/screens/school-office/text";
export const runtime = "nodejs";
export const metadata = { title: "Certificate settings" };
export default async function CertificateTemplatePage() {
  const staff = await requirePermission("certificates:manage", "/school-office/template");
  const template = await currentCertificateTemplate();
  return <VxPage><TopBar title={lead(O.setup, staff.language)} mBack="/school-office" /><main><Section><CertificateTemplateForm key={template.version} template={template} /></Section></main></VxPage>;
}
