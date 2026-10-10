import { requirePermission } from "@/platform/auth/current-staff";
import { daysBetween, greeting, shortDay } from "@/vx/format";
import { lead, p } from "@/vx/text";
import { EmptyState } from "@/vx/ui/primitives";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";
import { activityFor, countFor, currentExam, questionPapersFor, slotsFor, type Exam } from "@/vx/screens/exams/data";
import { GROUP_KEYS, GROUP_LABELS, groupOf } from "@/vx/screens/exams/domain/groups";
import { readiness, setupSteps } from "@/vx/screens/exams/domain/office";
import { paperStatus } from "@/vx/screens/exams/domain/tracker";
import { ExamHome, type HomeView, type NextExamView, type ResultsExamView, type TimelineItem } from "@/vx/screens/exams/office-home";
import { examProgress, officeContext } from "@/vx/screens/exams/office-data";

import { logCallAction, markChecklistAction, remindTeachersAction } from "./actions";

export const runtime = "nodejs";

const VIEWS = ["home", "menu", "checklist", "late", "remind"] as const;

/**
 * The exam coordinator's day (ExamHome): the exam whose results are being
 * put together, the next exam's setup, and the teachers who are behind.
 */
export default async function ExamOfficePage(props: PageProps<"/exam-office">) {
  await requirePermission("assessments:manage");
  const { staff } = await getViewer();
  const sp = await props.searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view: HomeView = (VIEWS as readonly string[]).includes(one("view") ?? "") ? (one("view") as HomeView) : "home";

  const ctx = await officeContext();
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={lead(p("Today", "आज"), staff.language)} />
        <main>
          <Section>
            <EmptyState icon="calendar" title={lead(p("No session is set up yet", "अभी कोई सत्र नहीं है"), staff.language)} />
          </Section>
        </main>
      </VxPage>
    );
  }
  const { today, exams } = ctx;
  const current = currentExam(exams, today, one("exam"));
  const next = pickNext(exams, current, today);

  /* --------------------------------------------- the results exam */
  let results: ResultsExamView | null = null;
  let teachers: Awaited<ReturnType<typeof examProgress>>["teachers"] = [];
  if (current) {
    const progress = await examProgress(ctx, current);
    teachers = progress.teachers;
    const bands = GROUP_KEYS.map((key) => {
      const list = progress.papers.filter((x) => groupOf(x.classLabel) === key);
      const total = list.reduce((a, x) => a + x.total, 0);
      const entered = list.reduce((a, x) => a + Math.min(x.entered, x.total), 0);
      return { key, label: GROUP_LABELS[key], percent: total ? Math.round((entered / total) * 100) : null };
    }).filter((b) => b.percent !== null) as ResultsExamView["bands"];
    const byTeacher = new Map<string, boolean>();
    for (const x of progress.papers) {
      if (!x.teacherId) continue;
      byTeacher.set(x.teacherId, (byTeacher.get(x.teacherId) ?? true) && paperStatus(x) === "done");
    }
    const plan = current.plan;
    results = {
      id: current.id,
      name: { en: current.labelEn, hi: current.labelHi },
      dates: span(current),
      percent: progress.overall.percent,
      entered: progress.overall.entered,
      total: progress.overall.total,
      teachersDone: [...byTeacher.values()].filter(Boolean).length,
      teachersTotal: byTeacher.size,
      lateCount: progress.lateCount,
      dueLabel: plan?.marksDueOn ? shortDay(plan.marksDueOn) : null,
      daysToDue: plan?.marksDueOn ? daysBetween(today, plan.marksDueOn) : null,
      resultsLabel: plan?.resultsOn ? shortDay(plan.resultsOn) : null,
      daysToResults: plan?.resultsOn ? daysBetween(today, plan.resultsOn) : null,
      ptmAt: plan?.ptmAt ?? null,
      bands,
    };
  }

  /* --------------------------------------------- the next exam */
  let nextView: NextExamView | null = null;
  if (next) {
    const [slots, seats, duties] = await Promise.all([slotsFor(next.id), countFor("exam_seats", next.id), countFor("exam_duties", next.id)]);
    const qps = await questionPapersFor(slots.map((s) => s.id));
    const steps = setupSteps({
      startsOn: next.startsOn,
      slots: slots.length,
      datesheetChecked: Boolean(next.plan?.datesheetCheckedAt),
      datesheetPublished: Boolean(next.plan?.datesheetPublishedAt),
      seats,
      duties,
      papersTotal: slots.length,
      papersReceived: qps.filter((q) => q.status !== "waiting").length,
      ticked: new Set(Object.keys(next.plan?.checklist ?? {})),
    });
    nextView = {
      id: next.id,
      name: { en: next.labelEn, hi: next.labelHi },
      dates: span(next),
      daysLeft: next.startsOn ? daysBetween(today, next.startsOn) : null,
      copiedFrom: next.plan?.copiedFrom ? (exams.find((e) => e.id === next.plan?.copiedFrom)?.labelEn ?? null) : null,
      slots: slots.length,
      papersReceived: qps.filter((q) => q.status !== "waiting").length,
      steps: steps.map((s) => ({ ...s, dueLabel: s.dueOn ? shortDay(s.dueOn) : null, daysLeft: s.dueOn ? daysBetween(today, s.dueOn) : null })),
      readiness: readiness(steps),
    };
  }

  /* --------------------------------------------- the year */
  const timeline: TimelineItem[] = exams.map((e) => {
    const state: TimelineItem["state"] =
      e.id === current?.id ? "now" : e.id === next?.id ? "next" : e.plan?.resultsPublishedAt || e.status === "locked" || (e.endsOn && e.endsOn < (current?.startsOn ?? today)) ? "done" : "later";
    return { id: e.id, name: { en: e.labelEn, hi: e.labelHi }, when: span(e), state };
  });

  const activity = (await activityFor([current?.id, next?.id].filter(Boolean) as string[], 8)).map((a) => ({
    id: a.id,
    text: { en: a.text_en, hi: a.text_hi ?? undefined },
    at: a.created_at,
    kind: a.kind,
  }));

  return (
    <ExamHome
      view={view}
      hello={greeting()}
      staffName={staff.displayName}
      sessionLabel={ctx.sessionLabel}
      todayLabel={shortDay(today)}
      results={results}
      next={nextView}
      teachers={teachers}
      timeline={timeline}
      activity={activity}
      remind={remindTeachersAction}
      logCall={logCallAction}
      markStep={markChecklistAction}
    />
  );
}

function span(e: Exam): string {
  if (!e.startsOn) return "";
  if (!e.endsOn || e.endsOn === e.startsOn) return shortDay(e.startsOn);
  return `${shortDay(e.startsOn)} – ${shortDay(e.endsOn)}`;
}

/** The exam to set up next: the first after the one being marked that has not begun. */
function pickNext(exams: Exam[], current: Exam | null, today: string): Exam | null {
  const later = exams.filter((e) => e.id !== current?.id && (!e.startsOn || e.startsOn > today));
  return later[0] ?? null;
}
