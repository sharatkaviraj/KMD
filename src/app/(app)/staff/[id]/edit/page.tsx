import { notFound } from "next/navigation";

import { updateStaffAction } from "@/app/(app)/staff/actions";
import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { t } from "@/platform/i18n/language";
import { getStaffById } from "@/modules/staff/data/staff-repo";
import { StaffForm } from "@/modules/staff/ui/staff-form";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.edit) };
}

export default async function EditStaffPage(props: PageProps<"/staff/[id]/edit">) {
  const { id } = await props.params;
  const actor = await requirePermission("staff:manage", `/staff/${id}/edit`);

  const person = await getStaffById(id);
  if (!person) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title={m.edit}
        language={actor.language}
        // A person's name is their name in every language, so it is passed
        // through as the same string on both sides rather than translated.
        back={{ href: `/staff/${id}`, label: t(person.displayName, person.displayName) }}
      />

      <StaffForm
        action={updateStaffAction}
        staff={person}
        cancelHref={`/staff/${id}`}
      />
    </>
  );
}
