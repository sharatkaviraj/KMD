import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { allCertificateTemplates } from "@/modules/certificates/data/repo";
import { readCertificateIdentity } from "@/modules/certificates/data/identity";
import { createAdminClient } from "@/platform/supabase/admin";
import { cleanProfile } from "@/vx/screens/settings/domain/settings";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { CertificateSettings } from "@/vx/screens/school-office/template";
import { O } from "@/vx/screens/school-office/text";
export const runtime = "nodejs";
export const metadata = { title: "Certificate settings" };
export default async function CertificateTemplatePage() {
  const staff = await requirePermission("certificates:manage", "/school-office/template");
  const [templates, identity, profile] = await Promise.all([allCertificateTemplates(), readCertificateIdentity(), createAdminClient().from("school_settings").select("value").eq("key", "profile").maybeSingle()]);
  const school = cleanProfile(profile.data?.value, { nameEn: schoolProfile.name, nameHi: "", address: "", phone: "", affiliation: "", footer: "", logo: null, signature: null });
  return <VxPage><TopBar title={lead(O.setup, staff.language)} mBack="/school-office" /><main><Section><CertificateSettings templates={templates} identity={identity} schoolName={school.nameEn} /></Section></main></VxPage>;
}
