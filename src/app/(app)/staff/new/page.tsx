import { requirePermission } from "@/platform/auth/current-staff";
import { createStaffAction } from "@/app/(app)/staff/actions";
import { StaffForm } from "@/modules/staff/ui/staff-form";
import { Notice } from "@/ui/primitives";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export const metadata = { title: "नया स्टाफ़ · VPPS One" };

export default async function NewStaffPage() {
  await requirePermission("staff:manage", "/staff/new");

  return (
    <>
      <PageHeader
        title="नया स्टाफ़"
        titleEn="Add staff"
        back={{ href: "/staff", label: "स्टाफ़" }}
      />

      <Notice
        className="mb-5"
        tone="info"
        hi="यह प्रोफ़ाइल है, खाता नहीं। साइन इन के लिए खाता Supabase में अलग से बनता है।"
        en="This creates a profile, not a login. Sign-in accounts are created separately in Supabase — a teacher who never opens the app still needs a profile here, because the timetable joins on the short name."
      />

      <StaffForm action={createStaffAction} cancelHref="/staff" />
    </>
  );
}
