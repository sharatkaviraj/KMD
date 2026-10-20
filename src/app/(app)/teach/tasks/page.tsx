import { requirePermission } from "@/platform/auth/current-staff";
import { m } from "@/messages";
import { listTeacherTasks } from "@/modules/teacher-tasks/data/repo";
import { TeacherWork } from "@/modules/teacher-tasks/ui/teacher-work";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";

export const runtime = "nodejs";

export const metadata = { title: "My tasks" };

/** A teacher's own work from the office, in the teacher shell like the rest of /teach. */
export default async function Page() {
  const staff = await requirePermission("attendance:view", "/teach/tasks");
  const rows = await listTeacherTasks().catch(() => null);
  const title = lead(m.teacherTasks, staff.language);
  return (
    <VxPage label={title}>
      <TopBar title={title} mBack="/teach/more" />
      <main>
        <Section style={{ maxWidth: 760 }}>
          <TeacherWork rows={rows} language={staff.language} compact={false} office={false} />
        </Section>
      </main>
    </VxPage>
  );
}
