import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { academicContext, attendanceOn, classTeachersOn, staffDirectory } from "@/vx/screens/academics/data";
import { addDays, isDay, isMonth, isUuid, monthRange } from "@/vx/screens/academics/domain";

import { audienceSize, birthdays, eventById, eventsBetween, holidaysBetween, noticeCounts, noticesFor, rollByClass, staffAwayDetail } from "./data";
import { holidayItems, monthWeeks, sessionMonths, weekdayOf, type AttendanceFacts, type CalEvent } from "./domain";
import type { Away, Birthday, CalendarData, CalendarParams } from "./model";

/*
 * Everything the school calendar reads, for one request, as plain data
 * (`CalendarData`); `buildCalendar` in model.ts turns it into the screen.
 * The permission and class-scope rules are the ones the old screen kept:
 * `academics:manage` adds and asks to notify, `fees:view` sees fee dates,
 * and a reader scoped to some classes sees whole-school events and theirs.
 */

export async function loadCalendar(staff: CurrentStaff, params: CalendarParams): Promise<CalendarData | null> {
  const ctx = await academicContext(staff);
  if (!ctx) return null;
  const manage = can(staff, "academics:manage");
  const seesMoney = can(staff, "fees:view");
  const { session, today } = ctx;

  // The window: the whole session, widened to the month asked for and to the next 30 days.
  const months = sessionMonths(session, today);
  const asked = isMonth(params.month) ? params.month : (isDay(params.day) ? params.day : today).slice(0, 7);
  const grid = monthWeeks(asked);
  const edges = [monthRange(months[0]).first, monthRange(months[months.length - 1]).last, grid[0][0].day, grid[grid.length - 1][6].day, addDays(today, 30)];
  if (isDay(params.day)) edges.push(params.day);
  if (isDay(params.holiday)) edges.push(params.holiday);
  const from = edges.reduce((a, b) => (a < b ? a : b));
  const to = edges.reduce((a, b) => (a > b ? a : b));
  const awayFrom = [grid[0][0].day, today, ...(isDay(params.day) ? [params.day] : [])].reduce((a, b) => (a < b ? a : b));
  const awayTo = [grid[grid.length - 1][6].day, addDays(today, 30), ...(isDay(params.day) ? [params.day] : [])].reduce((a, b) => (a > b ? a : b));

  // The register for the one day a screen shows it: the month's side panel, or the day.
  const view = params.view ?? "";
  const shownDay = isDay(params.day) ? params.day : asked === today.slice(0, 7) ? today : monthRange(asked).first;
  const needsRegister = (view === "" || view === "month" || view === "day") && !isUuid(params.eventId) && !params.holiday;
  const wantsRegister = needsRegister && shownDay <= today && weekdayOf(shownDay) !== 0 && ctx.classes.length > 0;

  // One wave (D-440). The register waits only on the holidays and the notice
  // counts only on the notices, not on the slowest of the ten reads.
  const holidaysRead = holidaysBetween(session, from, to);
  const noticesRead = noticesFor(session, {});
  const registerRead = holidaysRead.then(async (holidays) => {
    if (!wantsRegister) return null;
    const closed = new Set(holidayItems(holidays).flatMap((h) => {
      const out: string[] = [];
      for (let d = h.startsOn; d <= h.endsOn; d = addDays(d, 1)) out.push(d);
      return out;
    }));
    return closed.has(shownDay) ? null : attendanceOn(ctx, shownDay);
  });
  const countsRead = noticesRead.then((notices) =>
    noticeCounts(notices.map((n) => n.campaignId).filter((id): id is string => Boolean(id))));

  const [events, holidays, bdays, notices, audience, roll, away, teachers, directory, asEvent, att, counts] = await Promise.all([
    eventsBetween(session, from, to),
    holidaysRead,
    birthdays(session),
    noticesRead,
    audienceSize(session, []),
    rollByClass(session),
    staffAwayDetail(session, awayFrom, awayTo),
    classTeachersOn(session, today),
    staffDirectory(),
    isUuid(params.eventId) ? eventById(session, params.eventId) : Promise.resolve(null),
    registerRead,
    countsRead,
  ]);

  const attendance: Record<string, AttendanceFacts> = {};
  if (att) {
    attendance[shownDay] = {
      marked: att.marked,
      classes: att.classes.length,
      present: att.total.present + att.total.late,
      counted: att.total.counted,
      roll: att.classes.reduce((s, c) => s + c.roll, 0),
      notMarked: att.notMarked.map((c) => c.label),
    };
  }

  const all: CalEvent[] = asEvent && !events.some((e) => e.id === asEvent.id) ? [...events, asEvent] : events;
  const classLabels: Record<string, string> = {};
  for (const c of ctx.classes) classLabels[c.id] = c.label;
  for (const e of all) for (const id of e.classIds) classLabels[id] ??= ctx.label(id);
  const eventParents: Record<string, number> = {};
  for (const e of all) if (e.classIds.length) eventParents[e.id] = e.classIds.reduce((s, id) => s + (roll.get(id) ?? 0), 0);
  const classTeachers: Record<string, string> = {};
  for (const [classId, staffId] of teachers) {
    const name = directory.get(staffId)?.display_name;
    if (name) classTeachers[classId] = name;
  }
  const addedBy: Record<string, string> = {};
  for (const e of all) {
    const name = e.createdBy ? directory.get(e.createdBy)?.display_name : undefined;
    if (name) addedBy[e.id] = name;
  }
  const birthdaysByDay: Record<string, Birthday[]> = {};
  for (const [key, list] of bdays) birthdaysByDay[key] = list;
  const awayByDay: Record<string, Away[]> = {};
  for (const [day, list] of away) awayByDay[day] = list;
  const nextFeeDue = seesMoney ? events.filter((e) => e.kind === "fee_due" && !e.cancelled && e.startsOn > shownDay).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0] ?? null : null;

  return {
    language: staff.language,
    session,
    today,
    manage,
    seesMoney,
    everyClass: ctx.everyClass,
    classes: ctx.classes,
    classLabels,
    events,
    holidays,
    birthdays: birthdaysByDay,
    away: awayByDay,
    attendance,
    notices: notices.map((n) => ({ id: n.id, eventId: n.eventId, holidayDay: n.holidayDay, audience: n.audience, recipients: n.recipients, status: n.status, requestedAt: n.requestedAt, decidedAt: n.decidedAt, by: n.by, textHi: n.textHi, textEn: n.textEn, campaignId: n.campaignId })),
    counts,
    audience,
    eventParents,
    classTeachers,
    addedBy,
    event: asEvent,
    nextFeeDue,
  };
}
