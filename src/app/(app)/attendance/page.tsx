import { requirePermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { longDay, schoolToday } from "@/vx/format";
import { defaultBoardFocus, runningPeriod, schoolMinutes, type BoardFilter } from "@/vx/screens/admin/logic";
import { AttendanceScreen } from "@/vx/screens/admin/attendance";
import { loadBoard, loadSheet } from "@/vx/screens/admin/data";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

export const metadata = { title: "Attendance" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The whole-school attendance board (P5, design F11/D04): every class's
 * register today, and a panel to mark one on the class teacher's behalf.
 * `?class=<id>` opens the panel; `?f=pending|marked` keeps the filter.
 */
export default async function AttendanceBoardPage(props: PageProps<"/attendance">) {
  const staff = await requirePermission("attendance:mark_on_behalf", "/attendance");
  const { previewing } = await getViewer();
  const params = await props.searchParams;
  const picked = typeof params.class === "string" && UUID.test(params.class) ? params.class : null;
  const f = typeof params.f === "string" ? params.f : null;
  // No filter until one is picked: the desk then shows every class, the phone the ones not marked (F11/D04).
  const filter: BoardFilter | null = f === "pending" || f === "marked" || f === "all" ? f : null;
  const today = schoolToday();
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <VxPage>
        <TopBar title={lead(T.attendanceTitle, staff.language)} />
        <main>
          <Section>
            <EmptyState icon="calendar" title={lead(T.noSession, staff.language)} />
          </Section>
        </main>
      </VxPage>
    );
  }

  const board = await loadBoard(sessionLabel, today);
  // The desk's panel opens on a class whose teacher is away when none is picked; the phone opens a sheet only for a picked one.
  const classId = picked ?? (board.schoolOpen ? defaultBoardFocus(board.rows) : null);
  const sheet = classId ? await loadSheet(sessionLabel, today, classId, board) : null;
  const running = runningPeriod(board.bells, schoolMinutes());
  const first = [...board.bells].sort((a, b) => a.starts.localeCompare(b.starts))[0];
  const status = !board.schoolOpen
    ? lead(T.schoolClosed, staff.language)
    : running
      ? lead(running.state === "running" ? T.periodRunning(running.number) : T.periodBreak(running.number), staff.language)
      : first
        ? lead(schoolMinutes() < Number(first.starts.slice(0, 2)) * 60 + Number(first.starts.slice(3, 5)) ? T.beforeSchool : T.dayOver, staff.language)
        : "";

  return (
    <VxPage label={lead(T.attendanceTitle, staff.language)}>
      <AttendanceScreen
        board={board}
        sheet={sheet}
        focus={sheet ? (picked ? "explicit" : "default") : null}
        filter={filter}
        dayLine={`${longDay(today)}${status ? ` · ${status}` : ""}`}
        previewing={previewing !== null}
        canMark
      />
    </VxPage>
  );
}
