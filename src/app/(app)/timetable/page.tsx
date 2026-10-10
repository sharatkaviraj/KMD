import { requirePermission } from "@/platform/auth/current-staff";
import { loadTimetableScreen } from "@/vx/screens/timetable/data";
import { WEEK, type Weekday } from "@/vx/screens/timetable/domain/timetable";
import { TimetableScreen, type TimetableState, type TimetableView } from "@/vx/screens/timetable/timetable-screen";

export const runtime = "nodejs";

export const metadata = { title: "Timetable" };

type Params = { view?: string; class?: string; teacher?: string; cell?: string; pick?: string; duty?: string; sheet?: string; day?: string };

const VIEWS: readonly TimetableView[] = ["class", "teacher", "subs", "leave"];

function parseCell(raw: string | undefined): TimetableState["cell"] {
  if (!raw) return null;
  const m = /^([A-Za-z]+)-(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const day = m[1] as Weekday;
  const n = Number(m[2]);
  if (!WEEK.includes(day) || n < 1 || n > 12) return null;
  return { day, period: n - 1 };
}

/**
 * Timetable & substitutions (design `Timetable`). The classic week grid and
 * its import/version screens stay at /timetable/classic, /timetable/[id] and
 * /timetable/import; the cover day stays at /substitutions.
 */
export default async function TimetablePage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermission("timetable:view", "/timetable");
  const q = await searchParams;
  const data = await loadTimetableScreen(q.day ?? null);
  const state: TimetableState = {
    view: VIEWS.includes(q.view as TimetableView) ? (q.view as TimetableView) : "class",
    classId: q.class ?? null,
    teacherId: q.teacher ?? null,
    cell: parseCell(q.cell),
    pick: q.pick ?? null,
    duty: q.duty ?? null,
    sheet: q.sheet === "publish" || q.sheet === "leave" ? q.sheet : null,
  };
  return <TimetableScreen data={data} state={state} />;
}
