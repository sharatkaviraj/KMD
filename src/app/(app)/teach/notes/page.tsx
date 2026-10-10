import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { loadNotes, notesSearch } from "@/vx/screens/notes/load";
import { TeachNotes } from "@/vx/screens/notes/ui/workspace";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";

export const runtime = "nodejs";

export const metadata = { title: "My notes" };

/**
 * TchNotes: list; `?sheet=add` (`&step=listening|review|saved`, `&student=`);
 * `?note=<id>` detail; `?note=<id>&view=plan` or `?plan=<id>` the plan.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("notes:write", "/teach/notes");
  const data = await loadNotes(staff, notesSearch(await searchParams));
  if (!data) return <TeachEmpty kind="no-session" title={{ en: "My notes", hi: "मेरे नोट्स" }} back="/teach" />;
  return <TeachNotes {...data} school={schoolProfile.shortName} />;
}
