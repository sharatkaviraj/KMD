import { notFound } from "next/navigation";

import { updateSubjectAction } from "@/app/(app)/academics/actions";
import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { getSubjectById } from "@/modules/academics/data/academics-repo";
import { SubjectForm } from "@/modules/academics/ui/subject-form";
import { t } from "@/platform/i18n/language";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export default async function EditSubjectPage(
  props: PageProps<"/academics/subjects/[id]">,
) {
  const { id } = await props.params;
  const staff = await requirePermission("academics:manage", `/academics/subjects/${id}`);

  const subject = await getSubjectById(id);
  if (!subject) notFound();

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAcademics}
        title={m.subjectEdit}
        // The subject's own names, one per side — they are data, and the
        // school entered both.
        description={t(subject.nameHi, subject.nameEn)}
        language={staff.language}
        back={{ href: "/academics/subjects", label: m.subjects }}
      />
      <SubjectForm action={updateSubjectAction} subject={subject} />
    </>
  );
}
