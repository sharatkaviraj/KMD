import Link from "next/link";
import { Plus } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { can } from "@/platform/auth/permissions";
import { flat, primary } from "@/platform/i18n/language";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { StaffList } from "@/modules/staff/ui/staff-list";
import { buttonClasses } from "@/ui/primitives/button";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.staffTitle) };
}

export default async function StaffPage() {
  const staff = await requirePermission("staff:view", "/staff");
  const language = staff.language;
  const people = await listStaff();

  return (
    <>
      <PageHeader
        title={m.staffTitle}
        description={m.staffIntro}
        language={language}
        action={
          can(staff, "staff:manage") ? (
            <Link
              href="/staff/new"
              className={buttonClasses({ size: "sm" })}
              aria-label={flat(m.staffNew, language)}
            >
              <Plus aria-hidden />
              {primary(m.add, language)}
            </Link>
          ) : null
        }
      />

      <StaffList staff={people} />
    </>
  );
}
