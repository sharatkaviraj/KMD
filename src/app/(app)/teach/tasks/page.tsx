import { requirePermission } from "@/platform/auth/current-staff";
import { schoolNow } from "@/platform/auth/qa-clock";
import { schoolProfile } from "@/platform/config/school";
import { listTeacherTasks } from "@/modules/teacher-tasks/data/repo";
import { TeacherWork } from "@/modules/teacher-tasks/ui/teacher-work";
import { p } from "@/vx/text";

import { TaskShell } from "./task-shell";

export const runtime = "nodejs";

export const metadata = { title: "My tasks" };

/**
 * A teacher's own work from the office, in the teacher shell like the rest
 * of /teach: Back, the language switch and help (smoke 20 Oct). Today's
 * attendance task follows the school clock and the calendar, so a holiday
 * asks for no register.
 */
export default async function Page() {
  const staff = await requirePermission("attendance:view", "/teach/tasks");
  const now = await schoolNow(staff);
  const rows = await listTeacherTasks(false, { now }).catch(() => null);
  return (
    <TaskShell title={p("My tasks", "मेरे काम")} back="/teach/more" phone={schoolProfile.officePhone || undefined}>
      <TeacherWork rows={rows} language={staff.language} compact={false} office={false} />
    </TaskShell>
  );
}
