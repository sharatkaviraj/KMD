import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { getSiteUrl } from "@/platform/env";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";

import { AcadAttendanceView, monthsAround, type AcadAttendanceProps, type AttendanceSheet } from "./attendance-view";
import { academicContext, attendanceMonth, attendanceOn, chronicAbsentees, holidaysIn, lastNotes, markSheet, recentStatuses, registerSheet } from "./data";
import { isMonth, isUuid, monthRange } from "./domain";
import { sayer } from "./ui";

/*
 * AcadAttendance's server half: it reads the chosen state (scoped to the
 * reader's classes) and hands plain props to `AcadAttendanceView`. States:
 * `?view=` today | month | chronic | register, and `?sheet=` remind | mark | call.
 */

type Props = { staff: CurrentStaff; view?: string; sheet?: string; classId?: string; month?: string; studentId?: string; filter?: string; who?: string; day?: string };

function schoolClock(): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date()).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();
}

export async function AcadAttendance(props: Props) {
  const { staff } = props;
  const language = staff.language;
  const say = sayer(language);
  const ctx = await academicContext(staff);
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={say("Attendance", "हाज़िरी")} />
        <Section>
          <EmptyState title={say("No session is open", "कोई सत्र खुला नहीं है")} />
        </Section>
      </VxPage>
    );
  }
  const view = ["month", "chronic", "register"].includes(props.view ?? "") ? props.view! : "today";
  const month = isMonth(props.month) ? props.month : ctx.today.slice(0, 7);
  const [today, chronic] = await Promise.all([attendanceOn(ctx, ctx.today), chronicAbsentees(ctx)]);
  const registerClass = ctx.classes.find((c) => c.id === props.classId) ?? ctx.classes.find((c) => today.classes.some((t) => t.classId === c.id && t.tally.absent > 0)) ?? ctx.classes[0] ?? null;
  const chronicRecent = view === "chronic" || view === "today" ? await recentStatuses(ctx, chronic.map((c) => c.studentId)) : new Map();
  const awayNow = (id: string) => {
    const list = chronicRecent.get(id) ?? [];
    let n = 0;
    for (let i = list.length - 1; i >= 0 && list[i].status === "absent"; i -= 1) n += 1;
    return n >= 2;
  };

  let sheet: AttendanceSheet = null;
  if (props.sheet === "remind" && can(staff, "messages:send")) {
    sheet = { kind: "remind", who: isUuid(props.who) ? props.who : null };
  } else if (props.sheet === "mark" && props.classId) {
    const roll = await markSheet(ctx, props.classId, ctx.today);
    const row = today.classes.find((c) => c.classId === props.classId);
    if (roll) sheet = { kind: "mark", roll, teacher: row?.teacherName ?? "—", allowed: can(staff, "attendance:mark_on_behalf") };
  } else if (props.sheet === "call" && props.studentId) {
    const child = chronic.find((c) => c.studentId === props.studentId);
    if (child && ctx.everyClass) sheet = { kind: "call", child, lastNote: (await lastNotes(ctx, [child.studentId])).get(child.studentId) ?? null };
  }

  const common = {
    language,
    today: ctx.today,
    nowLabel: schoolClock(),
    origin: getSiteUrl().replace(/\/$/, ""),
    attendance: today,
    chronicCount: chronic.length,
    registerClass,
    mayRemind: can(staff, "messages:send"),
    everyClass: ctx.everyClass,
    notesHref: can(staff, "notes:view") ? "/notes" : null,
    sheet,
  };

  let p: AcadAttendanceProps;
  if (view === "month") {
    const { first, last } = monthRange(month);
    const [data, holidays] = await Promise.all([attendanceMonth(ctx, month), holidaysIn(ctx.session, first, last)]);
    p = { ...common, view: "month", month: data, months: monthsAround(ctx.today, month), holidays, teachers: Object.fromEntries(today.classes.map((c) => [c.classId, c.teacherName])), day: props.day && /^\d{4}-\d{2}-\d{2}$/.test(props.day) ? props.day : null };
  } else if (view === "chronic") {
    const notes = await lastNotes(ctx, chronic.map((c) => c.studentId));
    p = { ...common, view: "chronic", list: chronic, recent: Object.fromEntries(chronicRecent), notes: Object.fromEntries([...notes].map(([id, n]) => [id, { body: n.body, by: n.by }])), filter: props.filter === "away" || props.filter === "nocall" ? props.filter : "all", teachers: Object.fromEntries(today.classes.map((c) => [c.classId, c.teacherName])) };
  } else if (view === "register") {
    const sheetData = registerClass ? await registerSheet(ctx, registerClass.id, month) : null;
    p = { ...common, view: "register", sheetData, classes: ctx.classes, teacher: today.classes.find((c) => c.classId === registerClass?.id)?.teacherName ?? null, filter: props.filter === "low" || props.filter === "abs" ? props.filter : "all", months: monthsAround(ctx.today, month) };
  } else if (ctx.classes.length === 0) {
    p = { ...common, view: "empty" };
  } else {
    const monthData = await attendanceMonth(ctx, ctx.today.slice(0, 7));
    p = { ...common, view: "today", filter: props.filter === "not" || props.filter === "marked" ? props.filter : "all", chronicAway: chronic.filter((c) => awayNow(c.studentId) || c.absentLastWeek >= 2).length, monthAvg: monthData.average };
  }
  return <AcadAttendanceView {...p} />;
}
