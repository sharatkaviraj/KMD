import "server-only";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { attendanceCalendarNotes, findRegister, registersForDay } from "@/modules/attendance/data/attendance-repo";
import { closedWhy, lastOpenDay, openOn, unmarkedDays, type ChooserContext, type RegisterContext } from "@/modules/attendance/domain/register-day";
import type { AttendChoices, AttendData } from "@/vx/screens/teach/data";
import { dayBefore } from "@/vx/screens/teach/domain/teach";

/*
 * The register page's own reads, around the loader's: why a day is closed and
 * where to go instead, the month's unmarked days, and which of the teacher's
 * classes are already marked (20 Oct smoke run, groups 6 and 19). Each read
 * fails soft: a hint that cannot be read never breaks the register.
 */

/** The register's context. `today` is the school's today by the reader's clock. */
export async function registerContext(data: AttendData, today: string): Promise<RegisterContext> {
  const notes = await attendanceCalendarNotes(data.sessionLabel).catch(() => new Map());
  const why = closedWhy(data.day, today, notes) ?? (data.closed ? { kind: "closed" as const } : null);

  let lastOpen: RegisterContext["lastOpen"] = null;
  if (why) {
    const from = why.kind === "future" ? today : dayBefore(data.day);
    const day = lastOpenDay(from > today ? today : from, notes);
    if (day && day !== data.day) {
      const reg = await findRegister(data.classId, data.sessionLabel, day, null).catch(() => null);
      lastOpen = { day, marked: Boolean(reg && reg.revision >= 1) };
    }
  }

  const holidays: RegisterContext["holidays"] = {};
  for (const [day, note] of notes) {
    if (day.startsWith(data.month) && !openOn(day, notes) && (note.en || note.hi)) holidays[day] = { en: note.en, hi: note.hi };
  }

  // Owed days: from the first day this month the class was marked, so a month
  // the school had not yet started using the app in does not read as owed.
  const marked = new Set(data.monthMarks.map((m) => m.day));
  const first = [...marked].sort()[0] ?? null;
  const unmarked = first ? unmarkedDays({ month: data.month, today: dayBefore(today), notes, marked, since: first }) : [];

  let others: RegisterContext["others"] = [];
  const rest = data.choices.filter((c) => c.classId !== data.classId);
  if (rest.length > 0 && rest.length <= 3 && !why) {
    const regs = await registersForDay(data.sessionLabel, data.day).catch(() => []);
    const saved = new Set(regs.filter((r) => r.period === null && r.revision >= 1).map((r) => r.classId));
    others = rest.map((c) => ({ classId: c.classId, classLabel: c.classLabel, marked: saved.has(c.classId) }));
  }

  return { today, closedWhy: why, lastOpen, holidays, unmarked, others };
}

/** The chooser's context: which day the rows open, and each class's state that day. */
export async function chooserContext(data: AttendChoices, today: string): Promise<ChooserContext | null> {
  const sessionLabel = await resolveSessionLabel().catch(() => null);
  if (!sessionLabel) return null;
  const notes = await attendanceCalendarNotes(sessionLabel).catch(() => new Map());
  const why = closedWhy(data.day, today, notes);
  const day = why ? (lastOpenDay(why.kind === "future" ? today : dayBefore(data.day), notes) ?? data.day) : data.day;
  const regs = await registersForDay(sessionLabel, day).catch(() => []);
  const savedAt: ChooserContext["savedAt"] = {};
  for (const c of data.choices) savedAt[c.classId] = null;
  for (const r of regs) if (r.period === null && r.revision >= 1 && r.classId in savedAt) savedAt[r.classId] = r.submittedAt ?? "";
  return { today, day, closedWhy: why, savedAt, sessionLabel };
}
