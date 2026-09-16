import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { TimetableImportForm } from "@/modules/timetable/ui/import-form";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.timetableUpload) };
}

export default async function TimetableImportPage() {
  const staff = await requirePermission("timetable:manage", "/timetable/import");

  return (
    <>
      <PageHeader
        title={m.timetableUpload}
        language={staff.language}
        back={{ href: "/timetable", label: m.timetableTitle }}
      />
      <TimetableImportForm />
    </>
  );
}
