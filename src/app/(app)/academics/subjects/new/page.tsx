import { createSubjectAction } from "@/app/(app)/academics/actions";
import { requirePermission } from "@/platform/auth/current-staff";
import { SubjectForm } from "@/modules/academics/ui/subject-form";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export const metadata = { title: "नया विषय · VPPS One" };

export default async function NewSubjectPage() {
  await requirePermission("academics:manage", "/academics/subjects/new");

  return (
    <>
      <PageHeader
        title="नया विषय"
        titleEn="Add subject"
        back={{ href: "/academics/subjects", label: "विषय" }}
      />
      <SubjectForm action={createSubjectAction} />
    </>
  );
}
