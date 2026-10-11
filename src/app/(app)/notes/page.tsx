import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { loadNotes, notesSearch } from "@/vx/screens/notes/load";
import type { BoardTab } from "@/vx/screens/notes/domain/notes";
import { NotesBoard } from "@/vx/screens/notes/ui/workspace";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";

export const runtime = "nodejs";

export const metadata = { title: "Notes" };

const TABS: BoardTab[] = ["action", "followups", "plans", "all"];

/**
 * Notes board: board (`?tab=`), `?student=<id>` the board scoped to one child
 * with her timeline, `?sheet=add`
 * (`&step=listening`), `?note=<id>` detail, `?plan=<id>` plan.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("notes:view", "/notes");
  const search = notesSearch(await searchParams);
  const data = await loadNotes(staff, search);
  if (!data) return <TeachEmpty kind="no-session" title={{ en: "Notes", hi: "नोट्स" }} back="/" />;
  // Scoped to one child, the board opens on all of her notes, not only the
  // ones that need action today.
  const tab = TABS.includes(search.tab as BoardTab) ? (search.tab as BoardTab) : data.scope ? "all" : "action";
  return <NotesBoard {...data} school={schoolProfile.shortName} tab={tab} />;
}
