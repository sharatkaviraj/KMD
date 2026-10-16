import { requirePermission } from "@/platform/auth/current-staff";
import Link from "next/link";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { pendingMoneyRequests } from "@/modules/dashboard/vx/admin-today";
import { schoolToday } from "@/vx/format";
import { sortInbox } from "@/vx/screens/admin/logic";
import { loadInbox } from "@/vx/screens/admin/data";
import { InboxScreen } from "@/vx/screens/admin/inbox";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";
import { listTeacherTasks } from "@/modules/teacher-tasks/data/repo";
import { TaskList } from "@/modules/teacher-tasks/ui/task-list";
import { AssignmentLauncher } from "@/modules/teacher-tasks/ui/assignment-sheet";
import { ManageTask } from "@/modules/teacher-tasks/ui/manage-task";
import { ms, photoMessages } from "@/messages/setup";
import { primary } from "@/platform/i18n/language";
import { loadTaskDelivery } from "@/modules/teacher-tasks/data/delivery";
import { TaskDelivery } from "@/modules/teacher-tasks/ui/task-delivery";

export const runtime = "nodejs";

export const metadata = { title: "Needs you" };

/**
 * Needs you (P5, design F02/D03): attendance not marked, cover that needs a
 * teacher, correction requests, answers to check, refunds and failed jobs —
 * each from the queue that already owns it, each decided through that
 * queue's own action.
 */
export default async function InboxPage(props: PageProps<"/inbox">) {
  const staff = await requirePermission("attendance:correct", "/inbox");
  const { previewing } = await getViewer();
  const params = await props.searchParams;
  const item = typeof params.item === "string" ? params.item : null;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <VxPage>
        <TopBar title={lead(T.needsYou, staff.language)} />
        <main>
          <Section>
            <EmptyState icon="calendar" title={lead(T.noSession, staff.language)} />
          </Section>
        </main>
      </VxPage>
    );
  }

  const { items, unavailable } = await loadInbox(staff, sessionLabel, schoolToday(), {
    refunds: can(staff, "fees:view") ? pendingMoneyRequests : undefined,
  });
  const canAssign = can(staff, "collection:manage");
  const tasks = canAssign ? await listTeacherTasks(true).catch(() => null) : [];
  const selectedTask = typeof params.task === "string" && tasks?.some(t => t.id === params.task) ? params.task : null;
  const delivery = selectedTask && !previewing ? await loadTaskDelivery(selectedTask).catch(()=>null) : null;

  return (
    <VxPage label={lead(T.needsYou, staff.language)}>
      <InboxScreen items={sortInbox(items)} initial={item} previewing={previewing !== null} unavailable={unavailable.length > 0} scope={{ accountId: staff.userId, sessionLabel, day: schoolToday() }} taskPanel={canAssign && <section className="mx-auto max-w-6xl space-y-4 px-4 pb-8">
        <AssignmentLauncher language={staff.language}/>
        {staff.role === "admin" && <Link className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-sm text-primary" href="/collection/review">{primary(photoMessages.review,staff.language)}</Link>}
        {tasks ? <TaskList office rows={tasks} language={staff.language} compact={params.tasks !== "all"}/> : <p role="alert">{primary(ms.taskUnavailable,staff.language)}</p>}
        {selectedTask && <ManageTask id={selectedTask} language={staff.language} collection={tasks?.find(t=>t.id===selectedTask)?.kind==="collection"}/>}
        {selectedTask && delivery && <TaskDelivery key={selectedTask} id={selectedTask} language={staff.language} {...delivery}/>}
      </section>} />

    </VxPage>
  );
}
