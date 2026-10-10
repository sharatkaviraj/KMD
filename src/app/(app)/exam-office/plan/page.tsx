import { requirePermission } from "@/platform/auth/current-staff";
import { daysBetween, shortDay } from "@/vx/format";
import { lead, p } from "@/vx/text";
import { EmptyState } from "@/vx/ui/primitives";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";
import { dutiesFor, enrolmentsFor, holidaysBetween, nextExam, papersOf, questionPapersFor, rooms, seatsFor, slotsFor } from "@/vx/screens/exams/data";
import { examDays, findClashes, type Slot } from "@/vx/screens/exams/domain/datesheet";
import { GROUP_DEFAULT_MINUTES, GROUP_KEYS, GROUP_LABELS, groupOf, isGroupKey, NOT_A_PAPER, type GroupKey } from "@/vx/screens/exams/domain/groups";
import { dutySpread } from "@/vx/screens/exams/domain/rooms";
import { onRoll } from "@/vx/screens/exams/domain/tracker";
import { officeContext } from "@/vx/screens/exams/office-data";
import { PlanBoard, type PlanView, type RoomView } from "@/vx/screens/exams/plan-board";

import {
  checkDatesheetAction,
  copyDatesheetAction,
  deleteSlotAction,
  fillSeatingAction,
  publishDatesheetAction,
  saveSlotAction,
  setPaperSetterAction,
  setPaperStatusAction,
  shareDutiesAction,
  swapSlotsAction,
} from "./actions";

export const runtime = "nodejs";

const VIEWS = ["datesheet", "slot", "clash", "seating", "room", "duties", "papers", "publish"] as const;

/** Planning the next exam (ExamPlan): date sheet, seating, duties, question papers, publishing. */
export default async function ExamPlanPage(props: PageProps<"/exam-office/plan">) {
  await requirePermission("assessments:manage");
  const { staff } = await getViewer();
  const sp = await props.searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view: PlanView = (VIEWS as readonly string[]).includes(one("view") ?? "") ? (one("view") as PlanView) : "datesheet";

  const ctx = await officeContext();
  const exam = ctx ? nextExam(ctx.exams, ctx.today, one("exam")) : null;
  if (!ctx || !exam) {
    return (
      <VxPage>
        <TopBar title={lead(p("Date sheet", "डेट शीट"), staff.language)} />
        <main>
          <Section>
            <EmptyState icon="calendar" title={lead(p("No exam to plan yet", "योजना के लिए कोई परीक्षा नहीं"), staff.language)} />
          </Section>
        </main>
      </VxPage>
    );
  }
  const { today } = ctx;

  const [slotRows, holidays, roomRows, seatRows, dutyRows, roll] = await Promise.all([
    slotsFor(exam.id),
    holidaysBetween(ctx.sessionLabel, exam.startsOn, exam.endsOn),
    rooms(),
    seatsFor(exam.id),
    dutiesFor(exam.id),
    enrolmentsFor(ctx.sessionLabel),
  ]);
  const qps = await questionPapersFor(slotRows.map((s) => s.id));
  const days = exam.startsOn && exam.endsOn ? examDays(exam.startsOn, exam.endsOn, holidays) : [...new Set(slotRows.map((s) => s.sits_on))].sort();

  const slots: Slot[] = slotRows.filter((s) => isGroupKey(s.group_key)).map((s) => ({ id: s.id, groupKey: s.group_key as GroupKey, subject: s.subject_label, day: s.sits_on, start: s.starts_at, minutes: s.minutes }));
  const clashes = findClashes(slots, holidays);
  // A slot may sit on a day outside the exam's own dates (moved, or a copied sheet); show those days too.
  const allDays = [...new Set([...days, ...slots.map((s) => s.day)])].sort();

  /* who sits, per band */
  const window = { startsOn: exam.startsOn ?? today, endsOn: exam.endsOn ?? today };
  const classOf = new Map(ctx.classes.map((c) => [c.id, c]));
  const children = new Map<GroupKey, number>();
  const rollOf = new Map<string, { roll: string | null; classId: string }>();
  for (const e of roll) {
    if (!onRoll(e, window, today)) continue;
    rollOf.set(e.studentId, { roll: e.roll ?? null, classId: e.classId });
    const band = groupOf(classOf.get(e.classId)?.label ?? "");
    if (band) children.set(band, (children.get(band) ?? 0) + 1);
  }
  const bands = GROUP_KEYS.map((key) => {
    const own = slots.filter((s) => s.groupKey === key);
    const start = mostCommon(own.map((s) => s.start)) ?? (key === "pre" ? "09:00" : "08:30");
    const minutes = mostCommon(own.map((s) => String(s.minutes))) ?? String(GROUP_DEFAULT_MINUTES[key]);
    return { key, label: GROUP_LABELS[key], children: children.get(key) ?? 0, start, minutes: Number(minutes) };
  });

  /* subjects each band sits, from this session's papers and the sheet itself */
  const allPapers = await papersOf(ctx.exams.map((e) => e.id));
  const subjects: Record<string, string[]> = {};
  for (const key of GROUP_KEYS) subjects[key] = [];
  for (const paper of allPapers) {
    const band = groupOf(paper.class_label);
    if (band && !NOT_A_PAPER.has(paper.subject_code) && !subjects[band].includes(paper.subject_code)) subjects[band].push(paper.subject_code);
  }
  for (const s of slots) if (!subjects[s.groupKey].includes(s.subject)) subjects[s.groupKey].push(s.subject);

  /* rooms and seating */
  const seatsByRoom = new Map<string, typeof seatRows>();
  for (const s of seatRows) seatsByRoom.set(s.room_id, [...(seatsByRoom.get(s.room_id) ?? []), s]);
  const roomViews: RoomView[] = roomRows
    .filter((r) => r.is_active)
    .map((r) => {
      const mine = seatsByRoom.get(r.id) ?? [];
      const byClass = new Map<string, number[]>();
      for (const s of mine) {
        const n = Number(rollOf.get(s.student_id)?.roll ?? NaN);
        byClass.set(s.class_id, [...(byClass.get(s.class_id) ?? []), Number.isFinite(n) ? n : 0]);
      }
      return {
        id: r.id,
        name: r.name,
        seats: r.seats,
        cols: r.cols,
        used: mine.length,
        classes: [...byClass].map(([classId, rolls]) => ({
          classId,
          label: classOf.get(classId)?.label ?? "—",
          count: rolls.length,
          from: Math.min(...rolls),
          to: Math.max(...rolls),
        })),
      };
    });
  const roomId = one("room") && roomViews.some((r) => r.id === one("room")) ? one("room")! : (roomViews.find((r) => r.used > 0) ?? roomViews[0])?.id ?? null;
  const chart = roomId
    ? (seatsByRoom.get(roomId) ?? []).map((s) => ({ seatNo: s.seat_no, classId: s.class_id, classLabel: classOf.get(s.class_id)?.label ?? "—", roll: rollOf.get(s.student_id)?.roll ?? null }))
    : [];
  const totalChildren = [...children.values()].reduce((a, b) => a + b, 0);

  /* duties */
  const teachers = ctx.staff.filter((s) => s.isTeaching);
  const classTeacherOf = new Map(ctx.classes.filter((c) => c.classTeacherId).map((c) => [c.classTeacherId!, c.label]));
  const dutyDays = [...new Set(slots.map((s) => s.day))].sort();
  const duties = dutyRows.map((d) => ({ day: d.sits_on, roomId: d.room_id, staffId: d.staff_profile_id }));
  const spread = dutySpread(duties, teachers.map((t) => ({ id: t.id, name: t.name })));

  /* question papers */
  const staffName = new Map(ctx.staff.map((s) => [s.id, s]));
  const papers = qps.map((q) => ({
    slotId: q.slot_id,
    status: q.status,
    setterId: q.setter_staff_id,
    setterName: q.setter_staff_id ? (staffName.get(q.setter_staff_id)?.name ?? null) : null,
    setterPhone: q.setter_staff_id ? (staffName.get(q.setter_staff_id)?.phone ?? null) : null,
  }));

  /* exams with a date sheet, to copy from */
  const sources = [];
  for (const e of ctx.exams) {
    if (e.id === exam.id) continue;
    const n = (await slotsFor(e.id)).length;
    if (n) sources.push({ id: e.id, name: { en: e.labelEn, hi: e.labelHi }, slots: n });
  }

  return (
    <PlanBoard
      view={view}
      slotId={one("slot") ?? null}
      exam={{
        id: exam.id,
        name: { en: exam.labelEn, hi: exam.labelHi },
        dates: exam.startsOn ? `${shortDay(exam.startsOn)}${exam.endsOn && exam.endsOn !== exam.startsOn ? ` – ${shortDay(exam.endsOn)}` : ""}` : "",
        daysLeft: exam.startsOn ? daysBetween(today, exam.startsOn) : null,
        checked: Boolean(exam.plan?.datesheetCheckedAt),
        publishedAt: exam.plan?.datesheetPublishedAt ?? null,
        copiedFrom: exam.plan?.copiedFrom ? (ctx.exams.find((e) => e.id === exam.plan?.copiedFrom) ?? null)?.labelEn ?? null : null,
        reportingTime: exam.plan?.reportingTime ?? "08:15",
      }}
      exams={ctx.exams.map((e) => ({ id: e.id, name: { en: e.labelEn, hi: e.labelHi } }))}
      days={allDays.map((d) => ({ day: d, label: shortDay(d), outside: !days.includes(d) }))}
      holidays={[...holidays]}
      bands={bands}
      slots={slots}
      clashes={clashes}
      subjects={subjects}
      sources={sources}
      rooms={roomViews}
      roomId={roomId}
      chart={chart}
      totalChildren={totalChildren}
      seated={seatRows.length}
      teachers={teachers.map((t) => ({ id: t.id, name: t.name, phone: t.phone, sub: classTeacherOf.get(t.id) ?? null }))}
      dutyDays={dutyDays.map((d) => ({ day: d, label: shortDay(d) }))}
      duties={duties}
      spread={spread}
      papers={papers}
      fromName={staff.displayName}
      actions={{
        saveSlot: saveSlotAction,
        swapSlots: swapSlotsAction,
        deleteSlot: deleteSlotAction,
        copy: copyDatesheetAction,
        check: checkDatesheetAction,
        publish: publishDatesheetAction,
        fillSeating: fillSeatingAction,
        shareDuties: shareDutiesAction,
        setPaperStatus: setPaperStatusAction,
        setPaperSetter: setPaperSetterAction,
      }}
    />
  );
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}
