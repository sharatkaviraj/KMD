import { requirePermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { certificateRoster, type RosterStudent } from "@/modules/certificates/data/repo";
import { assertNotPreviewing } from "@/vx/view-as";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { CertificateBatch } from "@/vx/screens/school-office/batch";
import { O } from "@/vx/screens/school-office/text";

export const runtime = "nodejs";
export const metadata = { title: "Certificates for a class" };

export default async function CertificateBatchPage() {
  const staff = await requirePermission("certificates:issue", "/school-office/batch");
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  let roster: RosterStudent[] | null = null;
  if (sessionLabel) roster = await certificateRoster(sessionLabel).catch(() => null);
  return <VxPage><TopBar title={lead(O.batchTitle, staff.language)} crumb={sessionLabel} mBack="/school-office" /><main><Section>
    {sessionLabel && roster ? <CertificateBatch sessionLabel={sessionLabel} roster={roster} /> : <EmptyState icon="alert" title={lead(O.source, staff.language)} />}
  </Section></main></VxPage>;
}
