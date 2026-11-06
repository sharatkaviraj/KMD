import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolProfile } from "@/platform/config/school";
import { loadMore } from "@/vx/screens/teach/data";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";
import { TeachMore, type MoreView } from "@/vx/screens/teach/ui/more";

import { makeMyMarksLinkAction } from "../marks/actions";

export const runtime = "nodejs";

export const metadata = { title: "More" };

const VIEWS: MoreView[] = ["menu", "news", "links", "timetable", "leave", "help", "profile"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** TchMore: menu, `?view=news|links|timetable|leave|help|profile`, `?sheet=leave` (the leave form over My leave). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("attendance:view", "/teach/more");
  const sp = await searchParams;
  const data = await loadMore(staff);
  if (!data) return <TeachEmpty kind="no-session" title={{ en: "More", hi: "और" }} back="/teach" />;
  const sheet = one(sp.sheet) === "leave" ? "leave" : null;
  const asked = one(sp.view);
  const view: MoreView = VIEWS.includes(asked as MoreView) ? (asked as MoreView) : sheet ? "leave" : "menu";
  return (
    <TeachMore
      data={data}
      initialView={view}
      initialSheet={sheet}
      makeLink={can(staff, "marks:write") ? makeMyMarksLinkAction : undefined}
      officePhone={schoolProfile.officePhone || undefined}
    />
  );
}
