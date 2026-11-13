import { Suspense } from "react";
import { builtinAiSession } from "@/lib/ai/access";
import { builtinAiPilot } from "@/lib/ai/config";
import { LazyBoloPanel } from "@/lib/ai/ui/lazy-bolo-panel";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolProfile } from "@/platform/config/school";
import { loadHome } from "@/vx/screens/teach/data";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";
import { TeachHome } from "@/vx/screens/teach/ui/home";
import { previewRefusal } from "@/vx/screens/exams/guards";
import { MyCertificateRequestsToday } from "@/vx/screens/teach/ui/certificates-today";
import { ParentNotesToday } from "@/vx/screens/parents/parent-notes";

export const runtime = "nodejs";

export const metadata = { title: "Today" };

/** TchHome: the teacher's day (states by `?sheet=news|subs|leave|help|link|wish`). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("attendance:view", "/teach");
  const sp = await searchParams;
  const data = await loadHome(staff);
  if (!data.periods) return <TeachEmpty kind="no-session" title={{ en: "Today", hi: "आज" }} back="/teach" />;
  const sheet = typeof sp.sheet === "string" ? sp.sheet : null;
  // Bolo works in the session this page shows; the voice route checks every request again.
  const voiceAvailable = Boolean(data.sessionLabel && builtinAiPilot()) && await builtinAiSession(staff) === data.sessionLabel && !await previewRefusal();
  return (
    <TeachHome
      data={data}
      name={staff.displayName}
      shortName={staff.shortName}
      initialSheet={sheet}
      school={schoolProfile.shortName}
      officePhone={schoolProfile.officePhone}
      bolo={voiceAvailable ? <LazyBoloPanel /> : undefined}
      certificates={data.sessionLabel && can(staff, "certificates:request") ? <Suspense fallback={null}><MyCertificateRequestsToday sessionLabel={data.sessionLabel} language={staff.language} /></Suspense> : undefined}
      parents={data.sessionLabel && can(staff, "attendance:mark") ? <Suspense fallback={null}><ParentNotesToday staff={staff} sessionLabel={data.sessionLabel} day={data.today} /></Suspense> : undefined}
      allowed={{ attendance: can(staff, "attendance:mark"), marks: can(staff, "marks:write"), notes: can(staff, "notes:write") }}
    />
  );
}
