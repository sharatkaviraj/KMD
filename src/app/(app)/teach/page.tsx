import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolProfile } from "@/platform/config/school";
import { loadHome } from "@/vx/screens/teach/data";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";
import { TeachHome } from "@/vx/screens/teach/ui/home";

export const runtime = "nodejs";

export const metadata = { title: "Today" };

/** TchHome: the teacher's day (states by `?sheet=news|subs|leave|help|link|wish`). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("attendance:view", "/teach");
  const sp = await searchParams;
  const data = await loadHome(staff);
  if (!data.periods) return <TeachEmpty kind="no-session" title={{ en: "Today", hi: "आज" }} back="/teach" />;
  const sheet = typeof sp.sheet === "string" ? sp.sheet : null;
  return (
    <TeachHome
      data={data}
      name={staff.displayName}
      shortName={staff.shortName}
      initialSheet={sheet}
      school={schoolProfile.shortName}
      officePhone={schoolProfile.phone}
      allowed={{ attendance: can(staff, "attendance:mark"), marks: can(staff, "marks:write"), notes: can(staff, "notes:write") }}
    />
  );
}
