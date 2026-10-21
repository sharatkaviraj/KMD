import { requirePermission } from "@/platform/auth/current-staff";
import { schoolNow } from "@/platform/auth/qa-clock";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { pendingMoneyRequests } from "@/modules/dashboard/vx/admin-today";
import { schoolToday } from "@/vx/format";
import { schoolMinutes, sortInbox } from "@/vx/screens/admin/logic";
import { loadInbox } from "@/vx/screens/admin/data";
import { InboxScreen } from "@/vx/screens/admin/inbox";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, EmptyState } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";
import { listTeacherTasks } from "@/modules/teacher-tasks/data/repo";
import { TeacherWork } from "@/modules/teacher-tasks/ui/teacher-work";
import { TaskDetailSheet } from "@/modules/teacher-tasks/ui/task-detail-sheet";
import { AssignmentLauncher } from "@/modules/teacher-tasks/ui/assignment-sheet";
import { ManageTask } from "@/modules/teacher-tasks/ui/manage-task";
import { photoMessages } from "@/messages/setup";
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

  // The same clock as Today: a lab seat's set time, everyone else's real one (reads only, D-269).
  const now = await schoolNow(staff);
  const day = schoolToday(now);
  const { items, unavailable } = await loadInbox(staff, sessionLabel, day, {
    refunds: can(staff, "fees:view") ? pendingMoneyRequests : undefined,
    nowMinutes: schoolMinutes(now),
  });
  const canAssign = can(staff, "collection:manage");
  const tasks = canAssign ? await listTeacherTasks(true).catch(() => null) : [];
  const selectedTask = typeof params.task === "string" && tasks?.some(t => t.id === params.task) ? params.task : null;
  const delivery = selectedTask && !previewing ? await loadTaskDelivery(selectedTask).catch(()=>null) : null;

  const reviewPhotos = staff.role === "admin";
  const chosen = selectedTask ? tasks?.find(t => t.id === selectedTask) : undefined;
  const queueHref = params.tasks === "all" ? "/inbox?tasks=all" : "/inbox";

  return (
    <VxPage label={lead(T.needsYou, staff.language)}>
      <InboxScreen
        items={sortInbox(items)}
        initial={item}
        previewing={previewing !== null}
        unavailable={unavailable.length > 0}
        scope={{ accountId: staff.userId, sessionLabel, day }}
        taskActions={canAssign ? (
          <>
            {reviewPhotos ? <Btn icon="camera" href="/collection/review">{lead(photoMessages.review, staff.language)}</Btn> : null}
            <AssignmentLauncher language={staff.language} variant="pri" />
          </>
        ) : undefined}
        taskPanel={canAssign ? <TeacherWork rows={tasks} language={staff.language} compact={params.tasks !== "all"} reviewPhotos={reviewPhotos} /> : undefined}
        taskDetail={selectedTask && chosen ? (
          <TaskDetailSheet title={chosen.title} sub={chosen.teacherName ?? undefined} back={queueHref}>
            <ManageTask id={selectedTask} language={staff.language} collection={chosen.kind === "collection"} />
            {delivery ? <TaskDelivery key={selectedTask} id={selectedTask} language={staff.language} {...delivery} /> : null}
          </TaskDetailSheet>
        ) : undefined}
      />
    </VxPage>
  );
}
