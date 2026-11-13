import { requirePermission } from "@/platform/auth/current-staff";
import { Suspense } from "react";
import { SchoolOfficeAttention } from "@/vx/screens/school-office/attention";
import { schoolNow } from "@/platform/auth/qa-clock";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { schoolToday } from "@/vx/format";
import { schoolMinutes, sortInbox } from "@/vx/screens/admin/logic";
import { loadInbox, moneyRequestsFor } from "@/vx/screens/admin/data";
import { InboxScreen } from "@/vx/screens/admin/inbox";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, EmptyState } from "@/vx/ui/primitives";
import { getViewer, rolePreviewOf } from "@/vx/view-as";
import { listTeacherTasks } from "@/modules/teacher-tasks/data/repo";
import { collectToday, loadCollectBoard } from "@/modules/teacher-tasks/data/collect";
import { collectCounts, type BoardTask } from "@/modules/teacher-tasks/domain/collect";
import { TaskDetailSheet } from "@/modules/teacher-tasks/ui/task-detail-sheet";
import { AssignmentLauncher } from "@/modules/teacher-tasks/ui/assignment-sheet";
import { ManageTask } from "@/modules/teacher-tasks/ui/manage-task";
import { CollectSummary, NeedsYouViews } from "@/modules/teacher-tasks/ui/needs-you-views";
import { CW } from "@/modules/teacher-tasks/ui/collect-words";
import { photoMessages } from "@/messages/setup";
import { loadTaskDelivery } from "@/modules/teacher-tasks/data/delivery";
import { TaskDelivery } from "@/modules/teacher-tasks/ui/task-delivery";
import { CollectScreen } from "@/vx/screens/admin/collect-screen";
import { ParentsDecidedToday } from "@/vx/screens/parents/parent-notes";

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
  const viewer = await getViewer();
  const { previewing } = viewer;
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

  const canAssign = can(staff, "collection:manage");
  // Two halves (D-520): decisions, and the work handed to teachers. Only someone who can give work sees the second.
  const view = params.view === "collect" && canAssign ? "collect" : "decide";
  const tasks = canAssign ? await listTeacherTasks(true).catch(() => null) : [];
  const board: BoardTask[] | null = canAssign && tasks ? await loadCollectBoard(tasks).catch(() => null) : canAssign ? null : [];
  const today = collectToday();
  const counts = board ? collectCounts(board, today) : null;
  const selectedTask = typeof params.task === "string" && tasks?.some(t => t.id === params.task) ? params.task : null;
  // A role preview has no tasks of its own; seeing One as a person reads theirs (D-544).
  const delivery = selectedTask && !rolePreviewOf(viewer) ? await loadTaskDelivery(selectedTask).catch(()=>null) : null;

  const reviewPhotos = staff.role === "admin";
  const chosen = selectedTask ? tasks?.find(t => t.id === selectedTask) : undefined;
  const queueHref = view === "collect" ? "/inbox?view=collect" : params.tasks === "all" ? "/inbox?tasks=all" : "/inbox";
  const taskDetail = selectedTask && chosen ? (
    <TaskDetailSheet title={chosen.title} sub={chosen.teacherName ?? undefined} back={queueHref}>
      <ManageTask id={selectedTask} language={staff.language} collection={chosen.kind === "collection"} />
      {delivery ? <TaskDelivery key={selectedTask} id={selectedTask} language={staff.language} {...delivery} /> : null}
    </TaskDetailSheet>
  ) : undefined;

  if (view === "collect") {
    return (
      <VxPage label={`${lead(T.needsYou, staff.language)} · ${lead(CW.collect, staff.language)}`}>
        <CollectScreen
          language={staff.language}
          tasks={board}
          today={today}
          previewing={previewing !== null}
          views={<NeedsYouViews active="collect" decide={null} collect={counts?.attention ?? 0} language={staff.language} />}
          taskDetail={taskDetail}
        />
      </VxPage>
    );
  }

  // The same clock as Today: a lab seat's set time, everyone else's real one (reads only, D-269).
  const now = await schoolNow(staff);
  const day = schoolToday(now);
  const { items, unavailable } = await loadInbox(staff, sessionLabel, day, {
    refunds: moneyRequestsFor(staff, sessionLabel),
    nowMinutes: schoolMinutes(now),
  });
  const sorted = sortInbox(items);

  return (
    <VxPage label={lead(T.needsYou, staff.language)}>
      <InboxScreen
        items={sorted}
        initial={item}
        previewing={previewing !== null}
        unavailable={unavailable.length > 0}
        scope={{ accountId: staff.userId, sessionLabel, day }}
        views={canAssign ? <NeedsYouViews active="decide" decide={sorted.length} collect={counts?.attention ?? 0} language={staff.language} /> : undefined}
        taskActions={canAssign ? (
          <>
            {reviewPhotos ? <Btn icon="camera" href="/collection/review">{lead(photoMessages.review, staff.language)}</Btn> : null}
            <AssignmentLauncher language={staff.language} variant="pri" label={lead(CW.ask, staff.language)} />
          </>
        ) : undefined}
        taskPanel={(
          <>
            {/* A parent's suggestions decided today, each with Undo (D-598). */}
            <Suspense fallback={null}><ParentsDecidedToday staff={staff} sessionLabel={sessionLabel} day={day} /></Suspense>
            <Suspense fallback={null}><SchoolOfficeAttention sessionLabel={sessionLabel} /></Suspense>
            {canAssign ? <CollectSummary counts={counts} language={staff.language} /> : null}
          </>
        )}
        taskDetail={taskDetail}
      />
    </VxPage>
  );
}
