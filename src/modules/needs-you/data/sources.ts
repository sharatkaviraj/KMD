import "server-only";

import { dayBookClosure } from "@/modules/receipts/vx/domain/day-close";
import { getAccountsHomeData } from "@/modules/finance-controls/vx/books-data";
import type { AccountsHomeData } from "@/modules/finance-controls/vx/types";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolToday } from "@/platform/dates";
import { promisedToday } from "@/vx/screens/admin/data";
import { schoolMinutes } from "@/vx/screens/admin/logic";
import { countFor, currentExam, listExams, questionPapersFor, slotsFor, type Exam } from "@/vx/screens/exams/data";
import { plannedExams } from "@/vx/screens/exams/domain/current";
import { setupSteps, type SetupStep } from "@/vx/screens/exams/domain/office";
import { examProgress, officeContext } from "@/vx/screens/exams/office-data";
import { listCloseEvents } from "@/vx/screens/receipts/data";
import { remarksToWrite, type HomeData } from "@/vx/screens/teach/data";

import { counterNeeds, examNeeds, promiseNeeds, type ExamFacts } from "../domain/office";
import { teacherNeeds } from "../domain/teacher";
import type { DoneItem, NeedItem } from "../domain/types";

/**
 * Each person's jobs, read from the screens that already own them (D-630).
 * `complete` is false when any read failed: then nothing that left the list
 * may be counted as done, because a source that failed to load would
 * otherwise tick off everything it holds.
 */
export type NeedsSource = { items: NeedItem[]; done: DoneItem[]; complete: boolean };

export const NO_JOBS: NeedsSource = { items: [], done: [], complete: true };

/* ---------------------------------------------------------------- teacher */

/**
 * A teacher's jobs, from what her Today already loaded, plus the two reads
 * Today does not make: when each exam's marks are due (only with a marks
 * paper open) and the report-card remarks left (only for a class teacher).
 */
export async function teacherSource(staff: CurrentStaff, home: HomeData): Promise<NeedsSource> {
  let complete = true;
  const failed = <T>(value: T) => () => {
    complete = false;
    return value;
  };
  const [marksDue, remarksLeft] = await Promise.all([
    home.links.length > 0
      ? listExams(home.sessionLabel)
          .then((exams) => Object.fromEntries(exams.map((e) => [e.id, e.plan?.marksDueOn ?? null])))
          .catch(failed(undefined))
      : Promise.resolve(undefined),
    home.heldCount > 0 && can(staff, "marks:write") ? remarksToWrite(staff.id, home.sessionLabel, home.today).catch(failed(null)) : Promise.resolve(0),
  ]);
  return { ...teacherNeeds(home, { marksDue, remarksLeft }), complete };
}

/* -------------------------------------------------------------- the office */

/**
 * The fee office. In the real year money lives in Fees, and One only knows
 * the promises families made for today; in the test year (and wherever One
 * keeps the books) the counter, call-backs, cheques, UPI, requests and the
 * day's close, from the same read as the accountant's Today.
 */
export async function accountantSource(staff: CurrentStaff, input: { sessionLabel: string; feeSessionLabel: string; canonical: boolean; now: Date }): Promise<NeedsSource> {
  const today = schoolToday(input.now);
  if (!can(staff, "fees:view")) return { items: [], done: [], complete: true };
  if (input.canonical) {
    try {
      return { items: promiseNeeds(today, await promisedToday(input.sessionLabel, today)), done: [], complete: true };
    } catch {
      return { items: [], done: [], complete: false };
    }
  }
  try {
    const [home, events] = await Promise.all([
      getAccountsHomeData({ staffId: staff.id, today, sessionLabel: input.feeSessionLabel, seesAllRequests: can(staff, "fees:manage") }),
      listCloseEvents(today, today, { sessionLabel: input.feeSessionLabel }).catch(() => []),
    ]);
    return counterSourceFrom(staff, { ...home, closure: dayBookClosure(home.closure, events) }, input.now);
  } catch {
    return { items: [], done: [], complete: false };
  }
}

/** The fee office's jobs from what the accountant's Today already read; nothing is read here. */
export function counterSourceFrom(staff: CurrentStaff, home: Pick<AccountsHomeData, "today" | "queue" | "followUpsToday" | "chequesToDeposit" | "upiOpen" | "requests" | "closure">, now: Date): NeedsSource {
  return {
    ...counterNeeds({
      today: home.today,
      nowMinutes: schoolMinutes(now),
      now,
      canCollect: can(staff, "fees:collect"),
      canAccounts: can(staff, "fees:accounts"),
      queue: home.queue,
      followUpsToday: home.followUpsToday,
      chequesToDeposit: home.chequesToDeposit,
      upiOpen: home.upiOpen,
      requests: home.requests,
      closure: home.closure,
    }),
    complete: true,
  };
}

/* ------------------------------------------------------------ exam office */

type ExamFactsInput = {
  today: string;
  nowMinutes: number;
  current: Exam | null;
  progress: { lateCount: number; entered: number; total: number } | null;
  next: Exam | null;
  steps: readonly SetupStep[] | null;
};

/** The exam office's facts from what its Today already read; nothing is read here. */
export function examFactsFrom(input: ExamFactsInput): ExamFacts {
  const { current, next, progress, steps } = input;
  return {
    today: input.today,
    nowMinutes: input.nowMinutes,
    results:
      current && progress
        ? {
            id: current.id,
            name: { en: current.labelEn, hi: current.labelHi },
            lateCount: progress.lateCount,
            entered: progress.entered,
            total: progress.total,
            marksDueOn: current.plan?.marksDueOn ?? null,
            resultsOn: current.plan?.resultsOn ?? null,
            published: Boolean(current.plan?.resultsPublishedAt),
          }
        : null,
    next:
      next && steps
        ? {
            id: next.id,
            name: { en: next.labelEn, hi: next.labelHi },
            steps: steps.map((s) => ({ key: s.key, state: s.state, dueOn: s.dueOn, owner: s.owner, progress: s.progress })),
          }
        : null,
  };
}

/** The exam to set up next: the first after the one being marked that has not begun (as the exam office's Today picks it). */
export function nextExamToSetUp(exams: Exam[], current: Exam | null, today: string): Exam | null {
  return exams.find((e) => e.id !== current?.id && (!e.startsOn || e.startsOn > today)) ?? null;
}

/** The exam coordinator's jobs, read the way the exam office's Today reads them. */
export async function examSource(staff: CurrentStaff, now: Date): Promise<NeedsSource> {
  if (!can(staff, "assessments:manage")) return { items: [], done: [], complete: true };
  try {
    const ctx = await officeContext(now);
    if (!ctx) return { items: [], done: [], complete: true };
    const exams = plannedExams(ctx.exams);
    const current = currentExam(ctx.exams, ctx.today, undefined);
    const next = nextExamToSetUp(exams, current, ctx.today);
    const [progress, steps] = await Promise.all([
      current ? examProgress(ctx, current) : Promise.resolve(null),
      next
        ? Promise.all([slotsFor(next.id), countFor("exam_seats", next.id), countFor("exam_duties", next.id)]).then(async ([slots, seats, duties]) => {
            const qps = await questionPapersFor(slots.map((s) => s.id));
            return setupSteps({
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
          })
        : Promise.resolve(null),
    ]);
    const facts = examFactsFrom({
      today: ctx.today,
      nowMinutes: schoolMinutes(now),
      current,
      progress: progress ? { lateCount: progress.lateCount, entered: progress.overall.entered, total: progress.overall.total } : null,
      next,
      steps,
    });
    return { ...examNeeds(facts), complete: true };
  } catch {
    return { items: [], done: [], complete: false };
  }
}
