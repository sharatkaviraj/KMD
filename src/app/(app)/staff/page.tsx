import Link from "next/link";
import { Plus } from "lucide-react";

import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { StaffList } from "@/modules/staff/ui/staff-list";
import { buttonClasses } from "@/ui/primitives/button";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export const metadata = { title: "स्टाफ़ · VPPS One" };

export default async function StaffPage() {
  const staff = await requirePermission("staff:view", "/staff");
  const people = await listStaff();

  return (
    <>
      <PageHeader
        title="स्टाफ़"
        titleEn="Staff"
        description="हर अध्यापक की प्रोफ़ाइल — चाहे वे ऐप में साइन इन करें या नहीं। · Every teacher needs a profile, whether or not they sign in."
        action={
          can(staff, "staff:manage") ? (
            <Link
              href="/staff/new"
              className={buttonClasses({ size: "sm" })}
              aria-label="नया स्टाफ़ जोड़ें"
            >
              <Plus aria-hidden />
              जोड़ें
            </Link>
          ) : null
        }
      />

      <StaffList staff={people} />
    </>
  );
}
