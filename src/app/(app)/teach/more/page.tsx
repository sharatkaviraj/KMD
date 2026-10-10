import { requirePermission } from "@/platform/auth/current-staff";
import { loadMore } from "@/vx/screens/teach/data";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";
import { TeachMore, type MoreView } from "@/vx/screens/teach/ui/more";

export const runtime = "nodejs";

export const metadata = { title: "More" };

const VIEWS: MoreView[] = ["menu", "news", "links", "timetable", "profile"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** TchMore: menu, `?view=news|links|timetable|profile`, `?sheet=leave|help` (`?view=leave|help` too). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("attendance:view", "/teach/more");
  const sp = await searchParams;
  const data = await loadMore(staff);
  if (!data) return <TeachEmpty kind="no-session" title={{ en: "More", hi: "और" }} back="/teach" />;
  const view = one(sp.view);
  const sheet = one(sp.sheet) ?? (view === "leave" || view === "help" ? view : null);
  return <TeachMore data={data} initialView={VIEWS.includes(view as MoreView) ? (view as MoreView) : "menu"} initialSheet={sheet} />;
}
