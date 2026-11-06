import { createSubjectAction } from "@/app/(app)/academics/actions";
import * as m from "@/messages/pairs";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { SubjectForm } from "@/modules/academics/ui/subject-form";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.subjectNew) };
}

export default async function NewSubjectPage() {
  const staff = await requirePermission("academics:manage", "/academics/subjects/new");

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAcademics}
        title={m.subjectNew}
        language={staff.language}
        back={{ href: "/academics/subjects", label: m.subjects }}
      />
      <SubjectForm action={createSubjectAction} />
    </>
  );
}
