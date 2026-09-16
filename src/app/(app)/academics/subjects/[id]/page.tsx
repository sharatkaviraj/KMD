import { notFound } from "next/navigation";

import { updateSubjectAction } from "@/app/(app)/academics/actions";
import { requirePermission } from "@/platform/auth/current-staff";
import { getSubjectById } from "@/modules/academics/data/academics-repo";
import { SubjectForm } from "@/modules/academics/ui/subject-form";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export default async function EditSubjectPage(
  props: PageProps<"/academics/subjects/[id]">,
) {
  const { id } = await props.params;
  await requirePermission("academics:manage", `/academics/subjects/${id}`);

  const subject = await getSubjectById(id);
  if (!subject) notFound();

  return (
    <>
      <PageHeader
        title="विषय बदलें"
        titleEn={subject.nameEn}
        back={{ href: "/academics/subjects", label: "विषय" }}
      />
      <SubjectForm action={updateSubjectAction} subject={subject} />
    </>
  );
}
