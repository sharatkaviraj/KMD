import { createStaffAction } from "@/app/(app)/staff/actions";
import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { rolesAssignableBy } from "@/modules/staff/domain/staff";
import { StaffForm } from "@/modules/staff/ui/staff-form";
import { Notice } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.staffNew) };
}

export default async function NewStaffPage() {
  const staff = await requirePermission("staff:manage", "/staff/new");
  const language = staff.language;

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAdministration}
        title={m.staffNew}
        language={language}
        back={{ href: "/staff", label: m.staffTitle }}
      />

      <Notice
        className="mb-5"
        tone="info"
        text={m.staffNewNotice}
        language={language}
      />

      <StaffForm
        action={createStaffAction}
        cancelHref="/staff"
        roles={rolesAssignableBy(staff.role)}
      />
    </>
  );
}
