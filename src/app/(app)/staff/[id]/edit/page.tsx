import { notFound } from "next/navigation";

import { updateStaffAction } from "@/app/(app)/staff/actions";
import { requirePermission } from "@/platform/auth/current-staff";
import { getStaffById } from "@/modules/staff/data/staff-repo";
import { StaffForm } from "@/modules/staff/ui/staff-form";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export const metadata = { title: "स्टाफ़ बदलें · VPPS One" };

export default async function EditStaffPage(props: PageProps<"/staff/[id]/edit">) {
  const { id } = await props.params;
  await requirePermission("staff:manage", `/staff/${id}/edit`);

  const person = await getStaffById(id);
  if (!person) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title="बदलें"
        titleEn={person.displayName}
        back={{ href: `/staff/${id}`, label: person.displayName }}
      />

      <StaffForm
        action={updateStaffAction}
        staff={person}
        cancelHref={`/staff/${id}`}
      />
    </>
  );
}
